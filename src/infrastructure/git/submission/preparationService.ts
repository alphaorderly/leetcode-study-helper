import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PreparationAction, PreparationSnapshot } from '../../../shared/contracts';
import {
  type GitHubSubmissionClient,
  parseConsistentRemote,
  resolveCanonicalRemoteName,
  CANONICAL_REMOTE_URL,
} from '../../github/githubSubmissionClient';
import { type GitRepositoryAdapter, relativeGitPath } from '../vscodeGit';
import type { SubmissionSolution } from './submissionFiles';
import { PreparationGit } from './preparationGit';
import { PreparationWorkflow, type PreparationRecord } from './preparationWorkflow';

/** 삭제된 풀이도 주차에 연결하기 위한 카탈로그 범위입니다. */
export interface PreparationScope {
  nickname: string;
  problems: readonly { slug: string; week?: number }[];
}

/** GitHub 검증과 VS Code 선택창을 보존 상태 머신에 연결합니다. */
export class PreparationService {
  /** 기존 Git/인증 경계를 재사용합니다. */
  constructor(
    private readonly adapter: GitRepositoryAdapter,
    private readonly github: GitHubSubmissionClient,
  ) {}

  /** root는 Git 어댑터가 확인한 저장소 경로만 사용합니다. */
  private async workflow(root: vscode.Uri): Promise<PreparationWorkflow> {
    const repository = await this.adapter.requireRepository(root);
    const git = new PreparationGit(repository.rootUri.fsPath, await this.adapter.executable());
    const origin = parseConsistentRemote(repository.state.remotes.find((r) => r.name === 'origin'));
    const expectedUrl = origin ? await git.text(['remote', 'get-url', 'origin']) : undefined;
    /** 매 원격 쓰기 단계에서 포크와 fetch/push URL을 다시 확인합니다. */
    const verify = async () => {
      await repository.status();
      const live = parseConsistentRemote(repository.state.remotes.find((r) => r.name === 'origin'));
      if (
        !origin ||
        !live ||
        live.url !== origin.url ||
        (await git.text(['remote', 'get-url', 'origin'])) !== expectedUrl
      )
        throw new Error('origin이 변경되었습니다.');
      const identity = await this.github.getForkIdentity(live, true);
      if (identity.status !== 'verified')
        throw new Error(identity.reason ?? 'GitHub 포크를 확인할 수 없습니다.');
    };
    return new PreparationWorkflow(git, {
      fetch: async () => {
        await verify();
        let canonical = resolveCanonicalRemoteName(repository.state.remotes);
        if (!canonical) {
          await repository.addRemote('upstream', CANONICAL_REMOTE_URL);
          canonical = 'upstream';
        }
        await repository.fetch({ remote: 'origin', prune: true });
        await repository.fetch({ remote: canonical, ref: 'main', prune: true });
        await repository.status();
        const commit = await git.ref(`${canonical}/main`);
        if (!commit) throw new Error('공식 main을 가져오지 못했습니다.');
        return commit;
      },
      push: async () => {
        await verify();
        await repository.push('origin', 'main', false);
        await repository.status();
        this.github.clearSubmissionCache();
      },
    });
  }

  /** 현재 브랜치 PR을 조회하여 병합과 마지막 head가 검증됐는지 반환합니다. */
  async currentPullRequest(root: vscode.Uri, force = true) {
    const repository = await this.adapter.requireRepository(root);
    if (force) await repository.status();
    const branch = repository.state.HEAD?.name;
    const origin = parseConsistentRemote(repository.state.remotes.find((r) => r.name === 'origin'));
    if (!branch || !/^week-\d{2}$/.test(branch) || !origin) return undefined;
    return this.github.getBranchPullRequest(origin, branch, force);
  }

  /** 디스크의 복구 정보는 원격 조회 실패와 무관하게 읽습니다. */
  async snapshot(root: vscode.Uri): Promise<PreparationSnapshot | undefined> {
    return (await this.workflow(root)).snapshot();
  }

  /** 기존 제출 쓰기도 동일한 저장소 잠금과 준비 기록을 확인합니다. */
  async mutation<T>(root: vscode.Uri, action: () => Promise<T>): Promise<T> {
    const repository = await this.adapter.requireRepository(root);
    let executable: string;
    try {
      executable = await this.adapter.executable();
    } catch {
      return action();
    }
    const git = new PreparationGit(repository.rootUri.fsPath, executable);
    const workflow = new PreparationWorkflow(git, {
      fetch: async () => {
        throw new Error('조회 전용');
      },
      push: async () => {
        throw new Error('조회 전용');
      },
    });
    return workflow.exclusive(async () => {
      if ((await workflow.records()).some((r) => r.phase !== 'done' && r.phase !== 'cancelled'))
        throw new Error('다음 주차 준비를 먼저 계속하거나 취소해 주세요.');
      return action();
    });
  }

  /** 선택창에서 Git 변경을 검토하고 새 주차 준비를 실행합니다. */
  async prepare(
    root: vscode.Uri,
    solutions: readonly SubmissionSolution[],
    scope?: PreparationScope,
  ): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error('먼저 워크스페이스를 신뢰해 주세요.');
    const workflow = await this.workflow(root);
    await workflow.exclusive(async () => {
      if (!(await vscode.workspace.saveAll(false))) return;
      const pr = await this.currentPullRequest(root);
      if (!pr?.merged_at || !pr.head?.sha)
        throw new Error('현재 주차 PR의 병합과 마지막 커밋을 확인한 뒤 다시 시도해 주세요.');
      const repository = await this.adapter.requireRepository(root);
      await repository.fetch({ remote: 'origin', prune: true });
      const preview = await workflow.preview(pr.head.sha);
      if (preview.branch !== pr.head.ref)
        throw new Error('PR 조회 도중 현재 브랜치가 변경되었습니다. 다시 확인해 주세요.');
      const byPath = new Map(
        solutions.map((solution) => [
          relativeGitPath(repository.rootUri, vscode.Uri.parse(solution.uri)),
          solution,
        ]),
      );
      /** 현재 파일이 없어도 카탈로그와 닉네임으로 삭제·이름 변경의 주차를 찾습니다. */
      const weekFor = (file: string) =>
        byPath.get(file)?.week ??
        (scope &&
        file.split('/').length === 2 &&
        path.basename(file).split('.')[0]?.toLowerCase() === scope.nickname.toLowerCase()
          ? scope.problems.find((problem) => problem.slug === file.split('/')[0])?.week
          : undefined);
      const weeks = [
        ...new Set(preview.files.flatMap((file) => (weekFor(file) ? [weekFor(file)!] : []))),
      ].filter((week) => `week-${String(week).padStart(2, '0')}` !== preview.branch);
      let targetWeek: number | undefined;
      let selected: string[] = [];
      if (preview.files.length) {
        const items = [
          ...weeks.map((week) => ({
            label: `Week ${String(week).padStart(2, '0')}로 풀이 이동`,
            week,
          })),
          { label: '모두 보관하고 main으로 돌아가기', week: undefined },
        ];
        const target = await vscode.window.showQuickPick(items, {
          title: '다음 주차 준비',
          placeHolder: '이동할 풀이 주차를 선택하세요. 나머지 변경은 보관함에 남습니다.',
        });
        if (!target) return;
        targetWeek = target.week;
        if (targetWeek !== undefined) {
          const candidates = preview.files.filter((file) => weekFor(file) === targetWeek);
          const files = await vscode.window.showQuickPick(
            candidates.map((file) => ({ label: file, picked: !preview.ambiguous })),
            {
              title: preview.ambiguous
                ? '이력이 달라졌습니다. 가져올 파일을 직접 선택하세요'
                : '이동할 풀이',
              canPickMany: true,
            },
          );
          if (!files) return;
          selected = files.map((file) => file.label);
        }
      }
      const detail = [
        `현재 브랜치: ${preview.branch}`,
        preview.ambiguous
          ? '이력이 달라 추가 커밋 범위를 확정할 수 없습니다.'
          : `병합 후 추가 커밋 ${preview.extraCommitCount}개${preview.extraCommits.length ? `\n${preview.extraCommits.join('\n')}` : ''}`,
        preview.mainNeedsBackup
          ? '기존 main을 백업하고 origin/main 기준으로 준비합니다.'
          : 'main을 가져와 공식 저장소와 동기화합니다.',
        preview.mainUpstream && preview.mainUpstream !== 'origin/main'
          ? `main 추적 대상 변경: ${preview.mainUpstream} → origin/main`
          : '',
        `이동: ${selected.length ? selected.join(', ') : '없음'}`,
        `보관: ${preview.files.filter((file) => !selected.includes(file)).join(', ') || '없음'}`,
        '원본 커밋과 파일은 보관함에 남고, 이동한 풀이는 다시 커밋할 수 있습니다.',
      ]
        .filter(Boolean)
        .join('\n');
      let comparing = false;
      while (true) {
        const choice = await vscode.window.showInformationMessage(
          '보존하고 다음 주차를 준비합니다.',
          { modal: !comparing, detail },
          '보존하고 다음 주차 준비',
          '변경 비교',
        );
        if (choice === '변경 비교') {
          const file = await vscode.window.showQuickPick(preview.files, { title: '비교할 파일' });
          if (file) await this.diff(workflow, preview.base, undefined, file);
          comparing = true;
          continue;
        }
        if (choice !== '보존하고 다음 주차 준비') return;
        break;
      }
      const live = await this.currentPullRequest(root);
      if (live?.number !== pr.number || live.head?.sha !== pr.head.sha || !live.merged_at)
        throw new Error('PR 상태가 바뀌었습니다. 다시 확인해 주세요.');
      const record = await workflow.start(preview, selected, targetWeek);
      await workflow.resume(record.id);
    });
  }

  /** 실행 중 파일 저장을 완료한 후 계속·취소·보관함 동작을 처리합니다. */
  async action(root: vscode.Uri, id: string, action: PreparationAction): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error('먼저 워크스페이스를 신뢰해 주세요.');
    if (!['continue', 'cancel', 'shelf', 'cleanup', 'conflicts', 'existingWeek'].includes(action))
      throw new Error('알 수 없는 준비 작업입니다.');
    const workflow = await this.workflow(root);
    await workflow.exclusive(async () => {
      if (!(await vscode.workspace.saveAll(false))) return;
      const record = await workflow.read(id);
      if (action === 'existingWeek') await workflow.openExistingTarget(id);
      if (action === 'continue') await workflow.resume(id);
      if (action === 'cancel') {
        const choice = await vscode.window.showWarningMessage(
          '현재 변경도 보관한 뒤 원본 브랜치와 스테이징 상태를 복원합니다. 이미 반영된 원격 main은 유지됩니다.',
          { modal: true },
          '원본 복원',
        );
        if (choice === '원본 복원') await workflow.cancel(id);
      }
      if (action === 'shelf') await this.shelf(workflow, record);
      if (action === 'conflicts') await this.resolve(workflow, record);
      if (action === 'cleanup') {
        const choice = await vscode.window.showWarningMessage(
          '보관 파일·기존 main·복구 백업 참조를 정리합니다. 원본 주차 백업 브랜치와 stash는 유지됩니다.',
          { modal: true },
          '기록 정리',
        );
        if (choice === '기록 정리') await workflow.cleanup(id);
      }
    });
  }

  /** Git blob을 임시 문서로 보여주어 바이너리와 삭제 파일도 비교합니다. */
  private async document(
    workflow: PreparationWorkflow,
    ref: string,
    file: string,
  ): Promise<vscode.Uri> {
    await workflow.git.validatePath(file);
    const folder = path.join(
      await workflow.git.directory(),
      'leetcode-study-preparation',
      'previews',
    );
    await fs.mkdir(folder, { recursive: true });
    const output = path.join(folder, `${randomUUID()}-${path.basename(file)}`);
    let content: Buffer;
    try {
      content = await workflow.git.run(['show', `${ref}:${file}`]);
    } catch {
      content = Buffer.alloc(0);
    }
    await fs.writeFile(output, content);
    return vscode.Uri.file(output);
  }

  /** 원본과 보관본 또는 현재 파일의 diff를 엽니다. */
  private async diff(
    workflow: PreparationWorkflow,
    base: string,
    snapshot: string | undefined,
    file: string,
  ): Promise<void> {
    const before = await this.document(workflow, base, file);
    const after = await this.document(workflow, snapshot ?? (await workflow.git.tree()), file);
    await vscode.commands.executeCommand('vscode.diff', before, after, `${file} · 보관 변경`);
  }

  /** 모든 보관 기록과 main·중단 시점 백업을 파일 단위로 열고 복원할 수 있습니다. */
  private async shelf(workflow: PreparationWorkflow, current: PreparationRecord): Promise<void> {
    const records = await workflow.records();
    const choice = await vscode.window.showQuickPick(
      records.map((record) => ({
        label: `${record.sourceBranch} → ${record.targetWeek ? `Week ${record.targetWeek}` : 'main'}`,
        description: record.id,
        record,
        picked: record.id === current.id,
      })),
      { title: '작업 보관함' },
    );
    if (!choice) return;
    const record = choice.record;
    const versions = [
      { label: '원본 풀이와 파일', ref: record.snapshot, base: record.base },
      ...(record.originalMain
        ? [{ label: '기존 main', ref: record.originalMain, base: record.syncBase ?? record.base }]
        : []),
      ...record.extras.map((ref, i) => ({
        label: `복구 전 변경 ${i + 1}`,
        ref,
        base: record.sourceHead,
      })),
    ];
    const version = await vscode.window.showQuickPick(versions, { title: '보관 시점' });
    if (!version) return;
    const files = await workflow.git.paths([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      version.base,
      version.ref,
      '--',
    ]);
    const file = await vscode.window.showQuickPick(files, { title: '보관 파일' });
    if (!file) return;
    const action = await vscode.window.showQuickPick(
      ['변경 비교', '보관본 열기', '현재 브랜치에 복원'],
      { title: file },
    );
    if (action === '변경 비교') await this.diff(workflow, version.base, version.ref, file);
    if (action === '보관본 열기')
      await vscode.commands.executeCommand(
        'vscode.open',
        await this.document(workflow, version.ref, file),
      );
    if (action === '현재 브랜치에 복원') {
      if (records.some((r) => r.phase !== 'done' && r.phase !== 'cancelled'))
        throw new Error('진행 중인 준비를 완료하거나 취소한 뒤 보관 파일을 복원해 주세요.');
      if ((await workflow.conflicts()).length) throw new Error('현재 충돌을 먼저 해결해 주세요.');
      const full = await workflow.git.validatePath(file);
      const confirm = await vscode.window.showWarningMessage(
        `${file}의 현재 내용을 보관한 뒤 선택한 보관본으로 복원합니다.`,
        { modal: true },
        '복원',
      );
      if (confirm !== '복원') return;
      const head = (await workflow.git.ref('HEAD'))!;
      const backup = await workflow.git.commitTree(await workflow.git.tree(), head);
      await workflow.git.run([
        'update-ref',
        `refs/leetcode-study/${record.id}/restore-${randomUUID()}`,
        backup,
      ]);
      record.extras.push(backup);
      // Keep recovery snapshots discoverable even if the subsequent file write fails.
      const folder = path.join(await workflow.git.directory(), 'leetcode-study-preparation');
      const journal = path.join(folder, `${record.id}.json`);
      await fs.writeFile(`${journal}.tmp`, JSON.stringify(record), { mode: 0o600 });
      await fs.rename(`${journal}.tmp`, journal);
      const entries = await workflow.git.run(['ls-tree', '-z', version.ref, '--', file]);
      if (entries.length) {
        if (!entries.toString().startsWith('100'))
          throw new Error('일반 파일만 보관함에서 복원할 수 있습니다.');
        try {
          if ((await fs.lstat(full)).isSymbolicLink())
            throw new Error('심볼릭 링크를 덮어쓸 수 없습니다.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const content = await workflow.git.run(['show', `${version.ref}:${file}`]);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content);
        await fs.chmod(full, entries.toString().startsWith('100755') ? 0o755 : 0o644);
      } else {
        await fs.rm(full, { force: true });
      }
    }
  }

  /** 텍스트는 편집기에서 수정하고 바이너리는 한쪽 내용을 선택한 뒤 해결 표시합니다. */
  private async resolve(workflow: PreparationWorkflow, record: PreparationRecord): Promise<void> {
    const files = [
      ...new Set([
        ...(await workflow.conflicts()),
        ...(record.pendingFile ? [record.pendingFile] : []),
      ]),
    ];
    const file = await vscode.window.showQuickPick(files, { title: '충돌·적용 결과 확인' });
    if (!file) return;
    const action = await vscode.window.showQuickPick(
      ['편집기에서 열기', '대상 브랜치 내용 사용', '가져오는 내용 사용', '수정 완료로 표시'],
      { title: file },
    );
    const full = await workflow.git.validatePath(file);
    if (action === '편집기에서 열기')
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(full));
    if (action === '대상 브랜치 내용 사용' || action === '가져오는 내용 사용') {
      const side = action === '대상 브랜치 내용 사용' ? '2' : '3';
      const entry = (await workflow.git.run(['ls-files', '--stage', '-z', '--', file]))
        .toString()
        .split('\0')
        .find((line) => line.split('\t')[0]?.endsWith(` ${side}`));
      if (entry)
        await workflow.git.run(['checkout', side === '2' ? '--ours' : '--theirs', '--', file]);
      else {
        const ref = side === '3' && record.phase === 'applying' ? record.snapshot : 'HEAD';
        const exists = await workflow.git.run(['ls-tree', '-z', ref, '--', file]);
        if (exists.length)
          await workflow.git.run(['restore', `--source=${ref}`, '--worktree', '--', file]);
        else await fs.rm(full, { force: true });
      }
      await workflow.git.run(['add', '--', file]);
      await workflow.reviewed(record.id, file);
    }
    if (action === '수정 완료로 표시') {
      await workflow.git.run(['add', '--', file]);
      await workflow.reviewed(record.id, file);
    }
  }
}
