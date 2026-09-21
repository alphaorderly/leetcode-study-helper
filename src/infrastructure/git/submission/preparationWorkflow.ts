import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PreparationSnapshot } from '../../../shared/contracts';
import type { PreparationGit } from './preparationGit';

/** 원격 인증은 기존 VS Code Git API를 통해 수행합니다. */
export interface PreparationRemote {
  /** 원격 refs를 새로 읽고 포크 신원을 다시 확인합니다. */
  fetch(): Promise<string>;
  /** 검증된 main을 일반 push합니다. */
  push(): Promise<void>;
}

/** GitHub에서 검증한 현재 주차 PR의 마지막 head입니다. */
export interface PreparationPreview {
  branch: string;
  head: string;
  base: string;
  fingerprint: string;
  files: string[];
  ambiguous: boolean;
  mainNeedsBackup: boolean;
  mainUpstream?: string;
  extraCommitCount: number;
  extraCommits: string[];
}

/** 각 쓰기 단계와 보관 ref를 디스크에 기록하여 중단 후 중복 실행을 막습니다. */
export interface PreparationRecord {
  version: 1;
  createdAt: number;
  id: string;
  phase:
    'preserve' | 'main' | 'sync' | 'push' | 'target' | 'apply' | 'applying' | 'done' | 'cancelled';
  sourceBranch: string;
  sourceHead: string;
  originalMain?: string;
  base: string;
  snapshot: string;
  fingerprint: string;
  stash?: string;
  dirty: boolean;
  files: string[];
  selected: string[];
  targetWeek?: number;
  canonical?: string;
  syncBase?: string;
  syncedHead?: string;
  targetHead?: string;
  applied: string[];
  pendingFile?: string;
  pendingFingerprint?: string;
  reviewedFile?: string;
  pushed: boolean;
  error?: string;
  extras: string[];
  originUrl: string;
}

const terminalPhases = new Set(['done', 'cancelled']);

/** 다음 주차 준비의 보존·동기화·복원 상태 머신입니다. 실제 Git 저장소로 독립 검증할 수 있습니다. */
export class PreparationWorkflow {
  /** Git 실행기와 인증을 담당하는 원격 실행기를 연결합니다. */
  constructor(
    readonly git: PreparationGit,
    private readonly remote: PreparationRemote,
  ) {}

  /** 저장 위치를 구하며 조회 시에는 디렉터리를 만들지 않습니다. */
  private async folder(): Promise<string> {
    return path.join(await this.git.directory(), 'leetcode-study-preparation');
  }

  /** 작업 ID를 파일명이나 ref로 사용하기 전에 제한합니다. */
  private validateId(id: string): void {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('잘못된 준비 작업 ID입니다.');
  }

  /** ref는 작업마다 분리되어 사용자 stash 순서와 독립적입니다. */
  private ref(id: string, suffix: string): string {
    this.validateId(id);
    return `refs/leetcode-study/${id}/${suffix}`;
  }

  /** journal은 임시 파일과 rename으로 교체합니다. */
  private async save(record: PreparationRecord): Promise<void> {
    const folder = await this.folder();
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(folder, `${record.id}.json`);
    await fs.writeFile(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  }

  /** 저장된 상태를 읽으며 알 수 없는 버전은 자동 실행하지 않습니다. */
  async read(id: string): Promise<PreparationRecord> {
    this.validateId(id);
    const record = JSON.parse(
      await fs.readFile(path.join(await this.folder(), `${id}.json`), 'utf8'),
    ) as PreparationRecord;
    if (record.version !== 1 || record.id !== id || !Array.isArray(record.selected))
      throw new Error('준비 작업 기록을 확인할 수 없습니다.');
    if (
      ![
        'preserve',
        'main',
        'sync',
        'push',
        'target',
        'apply',
        'applying',
        'done',
        'cancelled',
      ].includes(record.phase) ||
      !/^week-\d{2}$/.test(record.sourceBranch) ||
      [
        record.sourceHead,
        record.base,
        record.snapshot,
        record.originalMain,
        record.stash,
        record.canonical,
        record.syncBase,
        record.syncedHead,
        record.targetHead,
        ...record.extras,
      ].some((ref) => ref !== undefined && !/^[0-9a-f]{40,64}$/.test(ref)) ||
      (record.targetWeek !== undefined &&
        (!Number.isInteger(record.targetWeek) || record.targetWeek < 1 || record.targetWeek > 99))
    ) {
      throw new Error('준비 작업 기록의 브랜치와 ref를 확인할 수 없습니다.');
    }
    for (const file of [...record.files, ...record.selected]) await this.git.validatePath(file);
    return record;
  }

  /** 최근 기록부터 반환하며 손상된 journal을 숨기지 않습니다. */
  async records(): Promise<PreparationRecord[]> {
    let files: string[];
    try {
      files = await fs.readdir(await this.folder());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records = await Promise.all(
      files.filter((f) => f.endsWith('.json')).map((f) => this.read(f.slice(0, -5))),
    );
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 저장소 쓰기를 프로세스와 VS Code 창 사이에서 직렬화합니다. */
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const folder = await this.folder();
    await fs.mkdir(folder, { recursive: true });
    const lock = path.join(folder, 'lock');
    try {
      const handle = await fs.open(lock, 'wx', 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(await fs.readFile(lock, 'utf8'));
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          throw new Error('이 저장소에서 다른 Git 작업을 진행 중입니다.', { cause: error });
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
        }
        await fs.rm(lock);
        return this.exclusive(action);
      }
      throw new Error('준비 작업 잠금 상태를 확인할 수 없습니다. 다시 열어 주세요.', {
        cause: error,
      });
    }
    try {
      return await action();
    } finally {
      await fs.rm(lock, { force: true });
    }
  }

  /** 진행 중 merge·rebase·cherry-pick에서 새 작업을 시작하지 않습니다. */
  private async requireIdle(): Promise<void> {
    const directory = await this.git.directory();
    for (const marker of [
      'MERGE_HEAD',
      'rebase-merge',
      'rebase-apply',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
    ]) {
      try {
        await fs.access(path.join(directory, marker));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      throw new Error('진행 중인 Git 작업을 VS Code 소스 제어에서 완료하거나 취소해 주세요.');
    }
  }

  /** PR head와 로컬 상태를 비교하고 이동 가능한 파일을 미리 계산합니다. */
  async preview(prHead: string): Promise<PreparationPreview> {
    await this.requireIdle();
    if ((await this.records()).some((r) => !terminalPhases.has(r.phase)))
      throw new Error('진행 중인 다음 주차 준비를 먼저 계속하거나 취소해 주세요.');
    const ignored = await this.git.paths([
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '-z',
    ]);
    const tracked = new Set(await this.git.paths(['ls-tree', '-r', '--name-only', '-z', 'HEAD']));
    for (const file of ignored) {
      if (tracked.has(file))
        throw new Error(
          `${file}은 추적 해제 후 ignored 상태입니다. 파일을 다른 위치에 보존한 뒤 준비해 주세요.`,
        );
    }
    const branch = await this.git.text(['symbolic-ref', '--short', 'HEAD']);
    if (!/^week-\d{2}$/.test(branch)) throw new Error('병합된 week-XX 브랜치에서 시작해 주세요.');
    if (!/^[0-9a-f]{40,64}$/.test(prHead))
      throw new Error('PR의 마지막 커밋을 확인할 수 없습니다.');
    const head = (await this.git.ref('HEAD'))!;
    const resolved = await this.git.ref(prHead);
    let ambiguous = !resolved;
    if (resolved) {
      try {
        ambiguous = (await this.git.text(['merge-base', head, resolved])) !== resolved;
      } catch {
        ambiguous = true;
      }
    }
    const base = resolved ?? (await this.git.ref('origin/main'));
    if (!base) throw new Error('비교 기준을 가져오지 못했습니다. 원격 상태를 새로고침해 주세요.');
    const tree = await this.git.tree();
    const files = await this.git.paths([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      base,
      tree,
      '--',
    ]);
    const main = await this.git.ref('refs/heads/main');
    const origin = await this.git.ref('origin/main');
    let mainNeedsBackup = false;
    if (main && origin) {
      try {
        mainNeedsBackup = (await this.git.text(['merge-base', main, origin])) !== main;
      } catch {
        mainNeedsBackup = true;
      }
    }
    const mainUpstream = main
      ? await this.git.text(['for-each-ref', '--format=%(upstream:short)', 'refs/heads/main'])
      : undefined;
    return {
      branch,
      head,
      base,
      fingerprint: await this.git.fingerprint(),
      files,
      ambiguous,
      mainNeedsBackup,
      mainUpstream,
      extraCommitCount: ambiguous
        ? 0
        : Number(await this.git.text(['rev-list', '--count', `${base}..${head}`])),
      extraCommits: ambiguous
        ? []
        : (await this.git.text(['log', '--max-count=20', '--format=%h %s', `${base}..${head}`]))
            .split('\n')
            .filter(Boolean),
    };
  }

  /** 백업을 먼저 만들고 승인된 파일·주차만 journal에 기록합니다. */
  async start(
    preview: PreparationPreview,
    selected: string[],
    targetWeek?: number,
  ): Promise<PreparationRecord> {
    if ((await this.records()).some((r) => !terminalPhases.has(r.phase)))
      throw new Error('이미 진행 중인 준비 작업이 있습니다.');
    await this.requireIdle();
    if ((await this.git.fingerprint()) !== preview.fingerprint)
      throw new Error('미리보기 이후 Git 상태가 바뀌었습니다. 다시 확인해 주세요.');
    if (
      targetWeek !== undefined &&
      (!Number.isInteger(targetWeek) || targetWeek < 1 || targetWeek > 99)
    )
      throw new Error('잘못된 주차입니다.');
    if (selected.length && targetWeek === undefined)
      throw new Error('이동할 주차를 선택해 주세요.');
    for (const file of selected) {
      if (!preview.files.includes(file)) throw new Error('미리보기에 없는 파일입니다.');
      await this.git.validatePath(file);
    }
    const id = randomUUID();
    const snapshot = await this.git.commitTree(await this.git.tree(), preview.head);
    const originalMain = await this.git.ref('refs/heads/main');
    const record: PreparationRecord = {
      version: 1,
      createdAt: Date.now(),
      id,
      phase: 'preserve',
      sourceBranch: preview.branch,
      sourceHead: preview.head,
      base: preview.base,
      snapshot,
      fingerprint: preview.fingerprint,
      originalMain,
      dirty: Boolean(await this.git.text(['status', '--porcelain', '--untracked-files=all'])),
      files: preview.files,
      selected: [...new Set(selected)],
      targetWeek,
      pushed: false,
      extras: [],
      applied: [],
      originUrl: await this.git.text(['remote', 'get-url', 'origin']),
    };
    await this.git.run(['update-ref', this.ref(id, 'snapshot'), snapshot]);
    await this.git.run(['branch', `study-backup/${id}`, record.sourceHead]);
    if (originalMain) await this.git.run(['update-ref', this.ref(id, 'main'), originalMain]);
    await this.save(record);
    return record;
  }

  /** HEAD와 브랜치가 계획대로인지 쓰기 직전에 검사합니다. */
  private async expect(branch: string, head: string): Promise<void> {
    if (
      (await this.git.text(['symbolic-ref', '--short', 'HEAD'])) !== branch ||
      (await this.git.ref('HEAD')) !== head
    ) {
      throw new Error(
        '외부에서 브랜치 또는 커밋이 변경되었습니다. 보관함에서 비교하거나 원본으로 복원해 주세요.',
      );
    }
  }

  /** 실패한 명령이 index 일부를 바꿨을 수 있으므로 깨끗한 상태를 추측하지 않습니다. */
  private async requireClean(): Promise<void> {
    const status = await this.git.text(['status', '--porcelain', '--untracked-files=all']);
    if (status)
      throw new Error(
        `준비 도중 새 변경이 생겼습니다. 원본 복원으로 보존한 뒤 다시 시작해 주세요.\n${status}`,
      );
  }

  /** 단계 전후 기록을 확인하며 push 실패나 충돌에서 이어서 실행합니다. */
  async resume(id: string): Promise<void> {
    const record = await this.read(id);
    if (terminalPhases.has(record.phase)) return;
    try {
      record.error = undefined;
      if ((await this.git.text(['remote', 'get-url', 'origin'])) !== record.originUrl)
        throw new Error('origin이 변경되어 준비를 중단했습니다.');
      if (record.phase === 'preserve') await this.preserve(record);
      if (record.phase === 'main') await this.prepareMain(record);
      if (record.phase === 'sync') await this.sync(record);
      if (record.phase === 'push') {
        await this.expect('main', record.syncedHead!);
        await this.requireClean();
        const canonical = await this.remote.fetch();
        if (canonical !== record.canonical) {
          record.syncBase = record.syncedHead;
          record.canonical = canonical;
          record.phase = 'sync';
          await this.save(record);
          return this.resume(id);
        }
        const origin = (await this.git.ref('origin/main'))!;
        if ((await this.git.text(['merge-base', origin, record.syncedHead!])) !== origin)
          throw new Error('원격 main이 변경되었습니다. 원본 복원 후 다시 준비해 주세요.');
        await this.remote.push();
        record.pushed = true;
        record.phase = 'target';
        await this.save(record);
      }
      if (record.phase === 'target') await this.prepareTarget(record);
      if (record.phase === 'apply' || record.phase === 'applying') await this.applyDraft(record);
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      await this.save(record);
      throw error;
    }
  }

  /** 파일별 적용 진행을 기록하여 한 파일 실패가 다른 파일의 완료로 가려지지 않게 합니다. */
  private async applyDraft(record: PreparationRecord): Promise<void> {
    const branch = record.targetWeek
      ? `week-${String(record.targetWeek).padStart(2, '0')}`
      : 'main';
    await this.expect(branch, record.targetHead!);
    if ((await this.conflicts()).length)
      throw new Error('충돌 파일을 해결한 뒤 계속을 눌러 주세요.');
    if (record.phase === 'apply') await this.requireClean();
    record.phase = 'applying';
    for (const file of record.selected.filter((file) => !record.applied.includes(file))) {
      const fingerprint = await this.git.fingerprint();
      if (record.pendingFile === file && fingerprint !== record.pendingFingerprint) {
        if (record.reviewedFile !== file)
          throw new Error(
            `${file}의 적용 결과를 충돌 해결에서 검토하고 수정 완료로 표시해 주세요.`,
          );
      } else {
        record.pendingFile = file;
        record.pendingFingerprint = fingerprint;
        record.reviewedFile = undefined;
        await this.save(record);
        const patch = await this.git.run([
          'diff',
          '--binary',
          '--full-index',
          '--no-ext-diff',
          '--no-renames',
          record.base,
          record.snapshot,
          '--',
          file,
        ]);
        if (patch.length)
          await this.git.run(['apply', '--3way', '--index', '--whitespace=nowarn'], patch);
      }
      record.applied.push(file);
      record.pendingFile = undefined;
      record.pendingFingerprint = undefined;
      record.reviewedFile = undefined;
      await this.save(record);
    }
    if (record.selected.length) await this.git.run(['reset', 'HEAD', '--', ...record.selected]);
    record.phase = 'done';
    await this.save(record);
  }

  /** 사용자가 파일의 적용 결과를 검토했다는 사실을 보관합니다. */
  async reviewed(id: string, file: string): Promise<void> {
    const record = await this.read(id);
    if (record.pendingFile === file) {
      record.reviewedFile = file;
      await this.save(record);
    }
  }

  /** stash 생성 중 중단된 경우 고유 메시지로 찾고 SHA ref로 고정합니다. */
  private async preserve(record: PreparationRecord): Promise<void> {
    await this.expect(record.sourceBranch, record.sourceHead);
    if (record.dirty && !record.stash) {
      const marker = `leetcode-study:${record.id}`;
      const entries = (await this.git.text(['stash', 'list', '--format=%H %gs'])).split('\n');
      let stash = entries.find((entry) => entry.endsWith(marker))?.split(' ')[0];
      if (!stash) {
        if ((await this.git.fingerprint()) !== record.fingerprint)
          throw new Error('보존 전에 파일이 변경되었습니다. 다시 확인해 주세요.');
        await this.git.run(['stash', 'push', '--include-untracked', '-m', marker]);
        stash = await this.git.ref('refs/stash');
      }
      if (!stash || (await this.git.ref(`${stash}^1`)) !== record.sourceHead)
        throw new Error('작업 보관의 원본 커밋을 확인할 수 없습니다.');
      record.stash = stash;
      await this.git.run(['update-ref', this.ref(record.id, 'stash'), stash]);
      await this.save(record);
    }
    await this.requireClean();
    record.phase = 'main';
    await this.save(record);
  }

  /** 로컬 main은 백업 후 origin을 기준으로 만들며 원격 이력은 변경하지 않습니다. */
  private async prepareMain(record: PreparationRecord): Promise<void> {
    const canonical = await this.remote.fetch();
    const origin = await this.git.ref('origin/main');
    if (!origin) throw new Error('origin/main을 가져오지 못했습니다.');
    const branch = await this.git.text(['symbolic-ref', '--short', 'HEAD']);
    await this.requireClean();
    if (branch === record.sourceBranch) {
      await this.expect(record.sourceBranch, record.sourceHead);
      const main = await this.git.ref('refs/heads/main');
      if (main && main !== record.originalMain && main !== origin)
        throw new Error('준비 중 로컬 main이 변경되었습니다.');
      await this.git.run(['branch', '-f', 'main', origin]);
      record.syncBase = origin;
      record.canonical = canonical;
      await this.save(record);
      await this.git.run(['checkout', '--no-overwrite-ignore', 'main']);
    } else {
      if (!record.syncBase) throw new Error('main 전환 기록을 확인할 수 없습니다.');
      await this.expect('main', record.syncBase);
    }
    await this.git.run(['branch', '--set-upstream-to=origin/main', 'main']);
    record.phase = 'sync';
    await this.save(record);
  }

  /** merge 충돌은 사용자에게 남기고 해결 후 동일한 merge를 완료합니다. */
  private async sync(record: PreparationRecord): Promise<void> {
    const head = await this.git.ref('HEAD');
    const mergeHead = await this.git.ref('MERGE_HEAD');
    if (mergeHead) {
      await this.expect('main', record.syncBase!);
      if (mergeHead !== record.canonical) throw new Error('다른 merge가 진행 중입니다.');
      if ((await this.conflicts()).length)
        throw new Error('공식 main 동기화 충돌을 해결한 뒤 계속을 눌러 주세요.');
      await this.git.run(['commit', '--no-edit']);
    } else if (head === record.syncBase) {
      await this.expect('main', record.syncBase!);
      await this.requireClean();
      await this.git.run(['merge', '--no-edit', '--no-overwrite-ignore', record.canonical!]);
    } else {
      // Accept only the exact fast-forward or two-parent merge planned before the crash.
      const parents = (await this.git.text(['show', '-s', '--format=%P', 'HEAD'])).split(' ');
      if (
        head !== record.canonical &&
        !(parents.length === 2 && parents[0] === record.syncBase && parents[1] === record.canonical)
      ) {
        throw new Error('동기화 중 HEAD가 변경되었습니다. 보관함에서 원본을 확인해 주세요.');
      }
      await this.expect('main', head!);
      await this.requireClean();
    }
    record.syncedHead = (await this.git.ref('HEAD'))!;
    record.phase = 'push';
    await this.save(record);
  }

  /** 기존 대상 브랜치를 덮어쓰지 않고 공식 main 기반의 안전한 브랜치만 재사용합니다. */
  private async prepareTarget(record: PreparationRecord): Promise<void> {
    await this.requireClean();
    if (record.targetWeek === undefined) {
      await this.expect('main', record.syncedHead!);
      record.targetHead = record.syncedHead;
    } else {
      const branch = `week-${String(record.targetWeek).padStart(2, '0')}`;
      const local = await this.git.ref(`refs/heads/${branch}`);
      const remote = await this.git.ref(`refs/remotes/origin/${branch}`);
      if ((local && local !== record.canonical) || (remote && remote !== record.canonical)) {
        throw new Error(
          `${branch}에 기존 작업이 있습니다. 원본 복원 후 해당 주차의 제출을 먼저 완료해 주세요.`,
        );
      }
      const current = await this.git.text(['symbolic-ref', '--short', 'HEAD']);
      if (current !== 'main' && current !== branch)
        throw new Error('다른 브랜치로 전환되어 준비를 중단했습니다.');
      if (current === 'main') await this.expect('main', record.syncedHead!);
      else await this.expect(branch, record.canonical!);
      if (!local) await this.git.run(['branch', branch, record.canonical!]);
      await this.git.run(['checkout', '--no-overwrite-ignore', branch]);
      if (remote) await this.git.run(['branch', `--set-upstream-to=origin/${branch}`, branch]);
      record.targetHead = record.canonical;
    }
    record.phase = 'apply';
    await this.save(record);
  }

  /** 기존 주차를 덮어쓰지 않고 열며 이동하지 않은 초안은 보관함에 남깁니다. */
  async openExistingTarget(id: string): Promise<void> {
    const record = await this.read(id);
    if (record.phase !== 'target' || !record.targetWeek)
      throw new Error('기존 주차를 열 수 있는 단계가 아닙니다.');
    await this.expect('main', record.syncedHead!);
    await this.requireClean();
    const branch = `week-${String(record.targetWeek).padStart(2, '0')}`;
    const local = await this.git.ref(`refs/heads/${branch}`);
    const remote = await this.git.ref(`refs/remotes/origin/${branch}`);
    if (!local && !remote) throw new Error('기존 주차 브랜치를 찾을 수 없습니다.');
    if (!local) await this.git.run(['branch', branch, remote!]);
    await this.git.run(['checkout', '--no-overwrite-ignore', branch]);
    if (remote) await this.git.run(['branch', `--set-upstream-to=origin/${branch}`, branch]);
    record.phase = 'done';
    record.error =
      '기존 주차 작업을 열었습니다. 이동할 풀이는 보관함에서 비교하고 복원할 수 있습니다.';
    await this.save(record);
  }

  /** 충돌 파일은 Git의 NUL 구분 목록을 사용합니다. */
  async conflicts(): Promise<string[]> {
    return [...new Set(await this.git.paths(['diff', '--name-only', '--diff-filter=U', '-z']))];
  }

  /** 취소 전에 현재 내용과 원본 index를 별도 보존하여 해결 중 편집도 잃지 않습니다. */
  async cancel(id: string): Promise<void> {
    const record = await this.read(id);
    if (record.phase === 'cancelled') return;
    if ((await this.git.ref(`refs/heads/${record.sourceBranch}`)) !== record.sourceHead)
      throw new Error('원본 브랜치가 변경되었습니다. 보관함에서 비교해 주세요.');
    if (record.phase === 'preserve') {
      const entry = (await this.git.text(['stash', 'list', '--format=%H %gs']))
        .split('\n')
        .find((line) => line.endsWith(`leetcode-study:${id}`));
      record.stash ??= entry?.split(' ')[0];
      if (!record.stash) {
        record.phase = 'cancelled';
        await this.save(record);
        return;
      }
    }
    const mergeHead = await this.git.ref('MERGE_HEAD');
    if (mergeHead && (record.phase !== 'sync' || mergeHead !== record.canonical))
      throw new Error(
        '다른 Git merge를 자동 취소하지 않았습니다. VS Code에서 해당 작업을 먼저 완료해 주세요.',
      );
    if (!mergeHead && !(await this.conflicts()).length) await this.requireIdle();
    const branch = await this.git.text(['symbolic-ref', '--short', 'HEAD']);
    const allowed = [
      record.sourceBranch,
      'main',
      `week-${String(record.targetWeek).padStart(2, '0')}`,
    ];
    if (!allowed.includes(branch))
      throw new Error('다른 브랜치에서 취소할 수 없습니다. 보관함을 확인해 주세요.');
    const head = (await this.git.ref('HEAD'))!;
    const backup = await this.git.commitTree(await this.git.tree(), head);
    const suffix = `cancel-${record.extras.length}`;
    await this.git.run(['update-ref', this.ref(id, suffix), backup]);
    await fs.copyFile(
      path.join(await this.git.directory(), 'index'),
      path.join(await this.folder(), `${id}-${suffix}.index`),
    );
    record.extras.push(backup);
    if (!(await this.conflicts()).length) {
      const indexTree = await this.git.text(['write-tree']);
      const indexBackup = await this.git.commitTree(indexTree, head);
      await this.git.run(['update-ref', this.ref(id, `${suffix}-index`), indexBackup]);
      record.extras.push(indexBackup);
    }
    await this.save(record);
    if ((await this.git.tree()) !== (await this.git.text(['rev-parse', `${backup}^{tree}`])))
      throw new Error('복원 준비 중 파일이 변경되었습니다. 다시 시도해 주세요.');
    const untracked = await this.git.paths(['ls-files', '--others', '--exclude-standard', '-z']);
    // Only remove paths verified to be present in the retained tree. Ignored paths are never cleaned.
    for (const file of untracked) {
      const entry = await this.git.run(['ls-tree', '-z', backup, '--', file]);
      if (!entry.length) throw new Error(`보관을 확인할 수 없는 파일: ${file}`);
      const full = await this.git.validatePath(file);
      await fs.unlink(full);
    }
    if (await this.git.ref('MERGE_HEAD')) await this.git.run(['merge', '--abort']);
    await this.git.run(['reset', '--hard', head]);
    if ((await this.git.ref(`refs/heads/${record.sourceBranch}`)) !== record.sourceHead)
      throw new Error('원본 브랜치가 변경되었습니다. 보관함에서 복원할 파일을 선택해 주세요.');
    await this.git.run(['checkout', '--no-overwrite-ignore', record.sourceBranch]);
    if (record.stash) await this.git.run(['stash', 'apply', '--index', record.stash]);
    record.phase = 'cancelled';
    record.error = undefined;
    await this.save(record);
  }

  /** UI에는 ref 대신 복구 가능한 단계와 파일 목록을 전달합니다. */
  async snapshot(): Promise<PreparationSnapshot | undefined> {
    const records = await this.records();
    const record = records.find((r) => !terminalPhases.has(r.phase)) ?? records[0];
    if (!record) return undefined;
    return {
      id: record.id,
      phase: record.phase,
      sourceBranch: record.sourceBranch,
      targetWeek: record.targetWeek,
      error: record.error,
      completed: terminalPhases.has(record.phase),
      files: record.files,
      conflicts: [
        ...new Set([
          ...(await this.conflicts()),
          ...(record.pendingFile ? [record.pendingFile] : []),
        ]),
      ],
    };
  }

  /** 완료된 작업만 명시적으로 삭제하며 사용자 stash는 그대로 둡니다. */
  async cleanup(id: string): Promise<void> {
    const record = await this.read(id);
    if (!terminalPhases.has(record.phase))
      throw new Error('진행 중인 보관본은 삭제할 수 없습니다.');
    const refs = (
      await this.git.text(['for-each-ref', '--format=%(refname)', `refs/leetcode-study/${id}/`])
    )
      .split('\n')
      .filter(Boolean);
    for (const ref of refs) await this.git.run(['update-ref', '-d', ref]);
    await fs.rm(path.join(await this.folder(), `${id}.json`));
  }
}
