import {
  CANONICAL_REMOTE_URL,
  type GitHubSubmissionClient,
  type ParsedGitHubRemote,
  resolveCanonicalRemoteName,
} from '../../github/githubSubmissionClient';
import { getRefRelation } from '../refRelation';
import { type SubmissionSolution } from './submissionFiles';
import type { SubmissionGuards } from './submissionGuards';
import { type GitRepository, relativeChangePaths } from '../vscodeGit';

/**
 * 제출 명령이 필요로 하는 공식 main 동기화와 주차 브랜치 전환을 담당합니다.
 * require로 시작하는 일부 메서드도 fetch·remote 추가·병합·push를 수행하므로
 * 읽기 전용 조회에서 호출하지 않습니다. 각 메서드의 쓰기 여부와 순서를 확인해야 합니다.
 */
export class SubmissionBranches {
  /** 주차 브랜치 작업에 필요한 GitHub 조회기와 Git 상태 검증기를 보관합니다. */
  constructor(
    private readonly githubClient: GitHubSubmissionClient,
    private readonly guards: SubmissionGuards,
  ) {}

  /** HEAD와 origin/main의 관계를 조회하며 조회 실패를 동기화 안내 오류로 변환합니다. */
  private async originMainRelation(repository: GitRepository) {
    try {
      return await getRefRelation(repository, 'origin/main');
    } catch {
      throw new Error('origin/main을 가져오지 못했습니다.');
    }
  }

  /**
   * origin/main과 공식 main을 병합하고 쓰기 직전 HEAD·origin·공식 ref를 재검증해 push합니다.
   * 실패하면 로컬 동기화 결과를 보존하고 복구 안내를 오류에 포함합니다.
   */
  async performForkSync(
    repository: GitRepository,
    verifiedOrigin: ParsedGitHubRemote = this.guards.requireOrigin(repository),
  ): Promise<string> {
    await repository.fetch({ remote: 'origin', ref: 'main', prune: true });
    await repository.status();
    this.guards.requireCleanOperationState(repository);

    const originRelation = await this.originMainRelation(repository);
    if (originRelation === 'ahead') {
      throw new Error('origin에 push하지 않은 로컬 커밋을 먼저 처리해 주세요.');
    }
    if (originRelation === 'diverged') {
      throw new Error('로컬 main과 origin/main이 서로 분기되어 자동 동기화할 수 없습니다.');
    }
    if (originRelation === 'behind') {
      await this.mergeOrAbort(repository, 'origin/main');
    }

    const canonicalRemote = await this.ensureCanonicalRemote(repository);
    await repository.fetch({ remote: canonicalRemote, ref: 'main', prune: true });
    await repository.status();
    this.guards.requireCleanOperationState(repository);

    /** 공식 remote 이름은 upstream으로 고정하지 않습니다. 이후 비교·병합은 확인된 remote의 main을 기준으로 합니다. */
    const canonicalMain = `${canonicalRemote}/main`;
    /** 병합에 사용한 공식 main SHA입니다. push 직전 재조회로 기준이 바뀌면 같은 동기화 결과로 진행하지 않습니다. */
    const canonicalCommit = (await repository.getCommit(canonicalMain)).hash;
    const canonicalRelation = await getRefRelation(repository, canonicalMain);
    if (canonicalRelation === 'behind' || canonicalRelation === 'diverged') {
      await this.mergeOrAbort(repository, canonicalMain);
    }
    const finalOriginRelation = await this.originMainRelation(repository);
    if (finalOriginRelation !== 'equal' && finalOriginRelation !== 'ahead') {
      throw new Error('동기화 결과가 origin/main에서 이어지지 않아 push하지 않았습니다.');
    }
    /** origin·공식 main 반영 후의 로컬 결과입니다. 마지막 fetch 중 로컬 HEAD가 바뀌었는지 확인하는 비교값입니다. */
    const expectedHead = repository.state.HEAD?.commit;
    if (!expectedHead) {
      throw new Error('동기화된 main의 HEAD를 확인할 수 없습니다.');
    }
    await repository.fetch({ remote: 'origin', ref: 'main', prune: true });
    await repository.fetch({ remote: canonicalRemote, ref: 'main', prune: true });
    await repository.status();
    await this.revalidateForkSync(
      repository,
      verifiedOrigin,
      expectedHead,
      canonicalMain,
      canonicalCommit,
    );
    if (!repository.state.HEAD?.upstream) {
      await repository.setBranchUpstream('main', 'origin/main');
    }
    try {
      await repository.push('origin', 'main', false);
    } catch (error) {
      await repository.status();
      /** push 실패 시 병합 완료된 로컬 main을 되돌리지 않습니다. 남아 있는 상태를 읽어 재시도 안내를 구성합니다. */
      const recovery = await this.describeSyncRecovery(repository);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`origin/main push에 실패했습니다. ${recovery} (${detail})`, {
        cause: error,
      });
    }
    await repository.status();
    this.githubClient.clearSubmissionCache();
    return canonicalMain;
  }

  /** 병합 후 두 remote를 다시 fetch한 시점에 검사합니다. 병합 전의 허용 판단을 재사용하면 외부 변경을 놓칩니다. */
  private async revalidateForkSync(
    repository: GitRepository,
    verifiedOrigin: ParsedGitHubRemote,
    expectedHead: string,
    canonicalMain: string,
    canonicalCommit: string,
  ): Promise<void> {
    this.guards.requireCleanOperationState(repository);
    this.guards.requireUnchangedOrigin(repository, verifiedOrigin);
    if (repository.state.HEAD?.name !== 'main' || repository.state.HEAD.commit !== expectedHead) {
      throw new Error('동기화 push 직전에 main 또는 HEAD가 변경되어 중단했습니다.');
    }
    if ((await repository.getCommit(canonicalMain)).hash !== canonicalCommit) {
      throw new Error('동기화 중 공식 main이 변경되었습니다. 다시 동기화해 주세요.');
    }
    const liveOriginRelation = await this.originMainRelation(repository);
    if (liveOriginRelation !== 'equal' && liveOriginRelation !== 'ahead') {
      throw new Error('동기화 push 직전에 origin/main이 변경되어 중단했습니다.');
    }
  }

  /** push 실패 후 로컬 main을 되돌리지 않고, 남아 있는 동기화 결과에 맞는 복구 안내를 선택합니다. */
  private async describeSyncRecovery(repository: GitRepository): Promise<string> {
    let recovery: string;
    try {
      const relation = await this.originMainRelation(repository);
      recovery =
        relation === 'ahead'
          ? '로컬 main에는 동기화 결과가 안전하게 남아 있습니다. 네트워크를 확인한 뒤 다시 동기화해 주세요.'
          : '로컬 main과 origin/main 상태를 확인한 뒤 다시 동기화해 주세요.';
    } catch {
      recovery =
        '로컬 main의 동기화 결과를 보존했습니다. origin/main을 확인한 뒤 다시 시도해 주세요.';
    }
    return recovery;
  }

  /**
   * 주차 브랜치를 만들기 전 main과 origin·공식 main의 관계를 확인합니다.
   * 공식 remote가 없으면 추가하고 두 remote를 fetch합니다. 뒤처진 상태라면
   * 작업 파일 조건을 확인해 병합과 push까지 수행할 수 있습니다.
   * @returns 후속 이력 검사와 브랜치 생성 기준으로 사용할 공식 main ref 이름.
   */
  async requireSynchronizedMain(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
  ): Promise<string> {
    if (repository.state.HEAD?.name !== 'main') {
      throw new Error('새 주차 브랜치는 main에서만 만들 수 있습니다.');
    }
    const remoteName = await this.ensureCanonicalRemote(repository);
    await repository.fetch({ remote: 'origin', prune: true });
    await repository.fetch({ remote: remoteName, ref: 'main', prune: true });
    await repository.status();
    const canonicalMain = `${remoteName}/main`;
    const [originRelation, canonicalRelation] = await Promise.all([
      this.originMainRelation(repository),
      getRefRelation(repository, canonicalMain),
    ]);
    if (originRelation === 'ahead') {
      throw new Error('origin에 push하지 않은 로컬 커밋을 먼저 처리해 주세요.');
    }
    if (originRelation === 'diverged') {
      throw new Error('로컬 main과 origin/main이 서로 분기되어 자동 동기화할 수 없습니다.');
    }
    const needsSync =
      originRelation === 'behind' ||
      canonicalRelation === 'behind' ||
      canonicalRelation === 'diverged';
    if (!needsSync) {
      // equal: 동일 SHA. ahead: 공식 main을 이미 포함한 포크(merge 커밋 등).
      return canonicalMain;
    }
    if (this.guards.hasBlockingDirtyState(repository, solutions)) {
      throw new Error('스테이징 또는 풀이 외 추적 파일 변경을 정리한 뒤 포크를 동기화해 주세요.');
    }
    return this.performForkSync(repository);
  }

  /** 공식 remote를 찾고 없으면 upstream을 추가합니다. 기존 upstream이 다른 저장소면 중단합니다. */
  private async ensureCanonicalRemote(repository: GitRepository): Promise<string> {
    const existing = resolveCanonicalRemoteName(repository.state.remotes);
    if (existing) {
      return existing;
    }
    await repository.addRemote('upstream', CANONICAL_REMOTE_URL);
    await repository.status();
    return resolveCanonicalRemoteName(repository.state.remotes) ?? 'upstream';
  }

  /** 공식 main을 fetch하고 로컬에서 조회할 remote ref 이름을 반환합니다. */
  async fetchCanonicalMain(repository: GitRepository): Promise<string> {
    const remoteName = await this.ensureCanonicalRemote(repository);
    await repository.fetch({ remote: remoteName, ref: 'main', prune: true });
    await repository.status();
    return `${remoteName}/main`;
  }

  /** 기존 주차 브랜치의 tip·조상·파일 범위를 검증해 재사용하거나 새 브랜치를 만듭니다. */
  async checkoutSubmissionBranch(
    repository: GitRepository,
    branch: string,
    week: number,
    fileByPath: ReadonlyMap<string, SubmissionSolution>,
    canonicalMain: string,
  ): Promise<void> {
    const localBranch = await this.guards.getBranch(repository, branch);
    const remoteBranch = await this.guards.getBranch(repository, `origin/${branch}`);
    if (localBranch && remoteBranch && localBranch.commit !== remoteBranch.commit) {
      throw new Error(`${branch}의 로컬·원격 상태가 일치하지 않아 자동 재사용할 수 없습니다.`);
    }
    const existingRef = localBranch ? branch : remoteBranch ? `origin/${branch}` : undefined;
    if (existingRef) {
      const [canonicalCommit, mergeBase] = await Promise.all([
        repository.getCommit(canonicalMain),
        repository.getMergeBase(canonicalMain, existingRef),
      ]);
      if (mergeBase !== canonicalCommit.hash) {
        throw new Error(`${branch}가 현재 공식 main에서 이어지지 않아 자동 재사용할 수 없습니다.`);
      }
      await this.guards.requireSafeSubmissionHistory(
        repository,
        canonicalMain,
        existingRef,
        week,
        fileByPath,
      );
    }
    if (localBranch) {
      await repository.checkout(branch);
    } else {
      await repository.createBranch(branch, true, existingRef ?? canonicalMain);
      if (remoteBranch) {
        await repository.setBranchUpstream(branch, `origin/${branch}`);
      }
    }
    await repository.status();
    if (repository.state.HEAD?.name !== branch) {
      throw new Error(`${branch} 브랜치로 전환하지 못해 커밋하지 않았습니다.`);
    }
    if (remoteBranch && !repository.state.HEAD.upstream) {
      await repository.setBranchUpstream(branch, `origin/${branch}`);
      await repository.status();
    }
  }

  /** 다른 주차의 미푸시·미반영 변경을 검사합니다. 필요할 때 공식 main을 fetch합니다. */
  async requireNoOtherOutstandingWeek(
    repository: GitRepository,
    desiredBranch: string,
    fileByPath: ReadonlyMap<string, SubmissionSolution>,
    canonicalFilePaths: ReadonlySet<string> | undefined,
  ): Promise<void> {
    const refs = await repository.getRefs({});
    const localRefs = new Map(
      refs.flatMap((ref) =>
        /^week-\d{2}$/.test(ref.name ?? '') ? [[ref.name!, ref] as const] : [],
      ),
    );
    const remoteRefs = new Map(
      refs.flatMap((ref) => {
        const branch = ref.name?.match(/^origin\/(week-\d{2})$/)?.[1];
        return branch ? [[branch, ref] as const] : [];
      }),
    );
    const branches = new Set([...localRefs.keys(), ...remoteRefs.keys()]);
    const otherBranches = [...branches].filter((branch) => branch !== desiredBranch);
    if (otherBranches.length === 0) {
      return;
    }
    const canonicalMain = await this.fetchCanonicalMain(repository);
    for (const branch of otherBranches) {
      const local = localRefs.get(branch);
      const remote = remoteRefs.get(branch);
      if (local && (!remote || local.commit !== remote.commit)) {
        throw new Error(`${branch}에 push되지 않은 로컬 변경이 있어 새 주차를 시작할 수 없습니다.`);
      }
      const ref = remote ? `origin/${branch}` : branch;
      const mergeBase = await repository.getMergeBase(canonicalMain, ref);
      if (!mergeBase) {
        throw new Error(`${branch}의 공식 main 기준점을 확인할 수 없습니다.`);
      }
      const paths = relativeChangePaths(
        repository.rootUri,
        await repository.diffBetween(mergeBase, ref),
      );
      const outstandingPath = [...paths].find(
        (relativePath) => !fileByPath.has(relativePath) || !canonicalFilePaths?.has(relativePath),
      );
      if (outstandingPath) {
        throw new Error(
          `${branch} 제출이 공식 저장소에 반영되기 전에는 새 주차를 시작할 수 없습니다.`,
        );
      }
    }
  }

  /** 병합 중 충돌이 발생하면 해당 병합을 중단하고 원래 오류를 전달합니다. */
  private async mergeOrAbort(repository: GitRepository, ref: string): Promise<void> {
    try {
      await repository.merge(ref);
      await repository.status();
      this.guards.requireCleanOperationState(repository);
    } catch (error) {
      await repository.status();
      if (repository.state.mergeChanges.length > 0) {
        await repository.mergeAbort();
        await repository.status();
      }
      throw error;
    }
  }
}
