import type {
  BlockingTrackedFile,
  ForkIdentitySnapshot,
  LocalSubmissionHistorySnapshot,
  RepositorySubmissionSnapshot,
  SolutionSubmissionStatus,
  SubmissionCommitSnapshot,
  SubmissionFileSnapshot,
} from '../../../shared/contracts';
import { pullRequestStatus, type RemoteSubmissionState } from '../../github/githubSubmissionClient';
import {
  localSubmissionStatuses,
  singleWeek,
  summaryForStatuses,
  trackedFilesBlockSync,
  weekFromBranch,
} from './submissionModel';

/** 원격 조회 전 수집한 로컬 상태입니다. Git 쓰기를 허용하는 근거로 사용하지 않습니다. */
export interface LocalSubmissionContext {
  /** 현재 닉네임으로 발견한 풀이 후보입니다. 원격 비교 파일을 내 풀이와 기타 파일로 분류할 때 기준이 됩니다. */
  files: SubmissionFileSnapshot[];
  /** 저장소 상대 경로로 후보를 찾는 인덱스입니다. Git·GitHub의 경로와 화면의 URI를 연결합니다. */
  fileByPath: ReadonlyMap<string, SubmissionFileSnapshot>;
  indexPaths: ReadonlySet<string>;
  workingPaths: ReadonlySet<string>;
  conflictPaths: ReadonlySet<string>;
  stagedFiles: SubmissionFileSnapshot[];
  otherStagedFiles: string[];
  blockingTrackedFiles: BlockingTrackedFile[];
  branch: string | undefined;
  currentBranchWeek: number | undefined;
  requestedSubmissionBranch: string | undefined;
  canonicalRemoteName: string | undefined;
  local: { commits: SubmissionCommitSnapshot[]; history: LocalSubmissionHistorySnapshot };
  /** 로컬 커밋에 포함된 경로입니다. 작업 트리·index 상태만으로 미푸시 여부를 놓치지 않도록 합칩니다. */
  pendingPaths: ReadonlySet<string>;
  localStatuses: ReadonlyMap<string, SolutionSubmissionStatus>;
  localBlockedReason: string | undefined;
  localActiveSubmissionWeek: number | undefined;
}

/** 파일별 상태와 저장소 전체 상태를 함께 전달하는 내부 조회 결과입니다. */
export interface SubmissionStatusResult {
  statuses: ReadonlyMap<string, SolutionSubmissionStatus>;
  pullRequestNumbers: ReadonlyMap<string, number>;
  snapshot: RepositorySubmissionSnapshot;
}

/** 로컬 이력과 작업 파일 상태로 원격 조회 실패 시에도 표시할 정보를 계산합니다. */
export function projectLocalSubmission({
  files,
  indexPaths,
  workingPaths,
  conflictPaths,
  stagedFiles,
  currentBranchWeek,
  local,
}: Pick<
  LocalSubmissionContext,
  | 'files'
  | 'indexPaths'
  | 'workingPaths'
  | 'conflictPaths'
  | 'stagedFiles'
  | 'currentBranchWeek'
  | 'local'
>) {
  const pendingPaths = new Set(
    local.commits.flatMap(({ files: commitFiles }) =>
      commitFiles.map(({ relativePath }) => relativePath),
    ),
  );
  const localStatuses = new Map(
    localSubmissionStatuses({
      files,
      indexPaths,
      workingPaths,
      conflictPaths,
    }),
  );
  for (const file of files) {
    if (pendingPaths.has(file.relativePath) && localStatuses.get(file.uri) === 'unknown') {
      localStatuses.set(file.uri, 'push-needed');
    }
  }
  const localInspectionFailed = local.commits.some(
    ({ fileInspectionStatus }) => fileInspectionStatus === 'unavailable',
  );
  const localBlockedReason = describeLocalHistoryProblem(local.history, localInspectionFailed);
  const localActiveFiles = [
    ...stagedFiles,
    ...local.commits.flatMap(({ files: commitFiles }) => commitFiles),
  ];
  const localActiveWeeks = new Set(
    localActiveFiles.map(({ week }) => week).filter((week): week is number => week !== undefined),
  );
  const localActiveSubmissionWeek = resolveActiveWeek(localActiveWeeks, currentBranchWeek);

  return { pendingPaths, localStatuses, localBlockedReason, localActiveSubmissionWeek };
}

/** 원격 정보가 없을 때 로컬 커밋과 차단 사유를 보존하고 원격 작업은 비활성화합니다. */
export function buildUnavailableSubmission(
  context: LocalSubmissionContext,
  fork: ForkIdentitySnapshot,
): SubmissionStatusResult {
  const {
    branch,
    requestedSubmissionBranch,
    localActiveSubmissionWeek,
    stagedFiles,
    otherStagedFiles,
    local,
    localBlockedReason,
    localStatuses,
    canonicalRemoteName,
    blockingTrackedFiles,
  } = context;
  const snapshot: RepositorySubmissionSnapshot = {
    status: fork.status === 'unsupported' ? 'unsupported' : 'unavailable',
    branch,
    submissionBranch: requestedSubmissionBranch,
    activeSubmissionWeek: localActiveSubmissionWeek,
    fork,
    stagedFiles,
    otherStagedFiles,
    pendingCommits: local.commits,
    localHistory: local.history,
    forkFiles: [],
    otherForkFiles: [],
    blockedReason: localBlockedReason ?? fork.reason,
    summary: summaryForStatuses(localStatuses),
    canSync: false,
    canReturnToMain: false,
    hasCanonicalRemote: canonicalRemoteName !== undefined,
    behindOfficialMain: false,
    blockingTrackedFiles,
  };
  return { statuses: localStatuses, pullRequestNumbers: new Map(), snapshot };
}

/** 원격 조회와 실제 작업 파일 검사가 끝난 뒤 화면 상태를 계산할 입력입니다. 쓰기 허가로 재사용하지 않습니다. */
interface ReadySubmissionInput {
  fork: ForkIdentitySnapshot;
  remote: RemoteSubmissionState;
  remoteCommits: SubmissionCommitSnapshot[];
  statuses: ReadonlyMap<string, SolutionSubmissionStatus>;
  pullRequestNumbers: ReadonlyMap<string, number>;
  hasBlockingOriginCommits: boolean;
  hasDirtyTrackedState: boolean;
  hasUntrackedChanges: boolean;
  rebaseInProgress: boolean;
  hasCanonicalRemote: boolean;
}

/** 입출력 없이 조회 결과를 합성합니다. 같은 커밋은 push 완료 정보를 우선합니다. */
export function buildReadySubmission(
  context: LocalSubmissionContext,
  input: ReadySubmissionInput,
): SubmissionStatusResult {
  const {
    fileByPath,
    stagedFiles,
    otherStagedFiles,
    blockingTrackedFiles,
    branch,
    currentBranchWeek,
    requestedSubmissionBranch,
    local,
    localBlockedReason,
  } = context;
  const { fork, remote, remoteCommits, statuses, pullRequestNumbers, hasCanonicalRemote } = input;
  /** 단 하나의 열린 PR 등으로 확정한 원격 주차를 먼저 사용하고, 없으면 로컬에서 요청한 브랜치를 사용합니다. */
  const submissionBranch = remote.headBranch ?? requestedSubmissionBranch;
  const forkFiles = remote.compareFiles.flatMap(({ filename }) => {
    const file = fileByPath.get(filename);
    return file ? [file] : [];
  });
  const otherForkFiles = remote.compareFiles
    .map(({ filename }) => filename)
    .filter((filename) => !fileByPath.has(filename));
  /** 같은 SHA가 양쪽에 있으면 pushed 정보를 우선합니다. 결과에는 로컬 미푸시와 원격 반영 커밋이 함께 있습니다. */
  const commits = mergeSubmissionCommits(remoteCommits, local.commits);
  const { activeSubmissionWeek, mixedWeeks } = activeSubmissionScope(
    stagedFiles,
    commits,
    forkFiles,
    submissionBranch,
  );
  const pullRequestWeek = singleWeek(
    remote.pullRequestFiles.flatMap((relativePath) => {
      const file = fileByPath.get(relativePath);
      return file ? [file] : [];
    }),
  );
  const { canSync, syncDisabledReason, canReturnToMain } = submissionPermissions(context, input);
  const branchAllowed =
    branch === 'main' || (currentBranchWeek !== undefined && branch === submissionBranch);
  const hasOtherOpenPullRequest =
    remote.openPullRequestCount === 1 &&
    requestedSubmissionBranch !== undefined &&
    remote.headBranch !== requestedSubmissionBranch;
  /** 복수 문제가 있어도 먼저 해결할 사유 하나를 선택합니다. 아래 함수의 분기 순서가 화면 안내의 우선순위입니다. */
  const blockedReason = describeSubmissionBlock({
    localBlockedReason,
    remote,
    hasOtherOpenPullRequest,
    otherStagedFiles,
    mixedWeeks,
    branchAllowed,
  });
  /** 원격 PR을 현재 제출 주차와 브랜치가 포함된 화면 스냅샷으로 변환합니다. */
  const toPullRequestSnapshot = (
    pullRequest: NonNullable<RemoteSubmissionState['latestPullRequest']>,
  ) => ({
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.html_url,
    week: pullRequestWeek ?? weekFromBranch(remote.headBranch),
    branch: remote.headBranch ?? submissionBranch ?? 'week-unknown',
    status: pullRequestStatus(pullRequest),
  });
  const snapshot: RepositorySubmissionSnapshot = {
    status: blockedReason ? 'blocked' : 'ready',
    branch,
    submissionBranch,
    activeSubmissionWeek,
    fork,
    stagedFiles,
    otherStagedFiles,
    pendingCommits: commits,
    localHistory: local.history,
    forkFiles,
    otherForkFiles,
    activePullRequest: remote.activePullRequest
      ? toPullRequestSnapshot(remote.activePullRequest)
      : undefined,
    pullRequest: remote.latestPullRequest
      ? toPullRequestSnapshot(remote.latestPullRequest)
      : undefined,
    blockedReason,
    summary: summaryForStatuses(statuses),
    canSync,
    canReturnToMain,
    hasCanonicalRemote,
    behindOfficialMain: remote.behindBy > 0,
    syncDisabledReason,
    blockingTrackedFiles,
  };
  return { statuses, pullRequestNumbers, snapshot };
}

/** 브랜치·충돌·스테이징·풀이 외 변경·로컬 커밋 순서로 동기화 차단 사유를 반환합니다. */
function describeSyncDisabledReason(
  branch: string | undefined,
  blockingTrackedFiles: readonly BlockingTrackedFile[],
  rebaseInProgress: boolean,
  hasBlockingOriginCommits: boolean,
): string | undefined {
  if (branch !== 'main') {
    return '포크 동기화는 main 브랜치에서만 실행할 수 있습니다.';
  }
  if (rebaseInProgress || blockingTrackedFiles.some(({ state }) => state === 'conflict')) {
    return '진행 중인 merge 또는 rebase를 먼저 정리해 주세요.';
  }
  if (blockingTrackedFiles.some(({ state }) => state === 'staged')) {
    return '스테이징된 파일을 먼저 정리해 주세요.';
  }
  if (blockingTrackedFiles.some(({ kind }) => kind === 'other')) {
    return '풀이 외 추적 파일 변경을 되돌린 뒤 포크를 동기화해 주세요.';
  }
  if (hasBlockingOriginCommits) {
    return 'origin에 push하지 않은 로컬 커밋을 먼저 처리해 주세요.';
  }
  return undefined;
}

/** 파일에 지정된 주차가 없을 때만 현재 브랜치의 주차를 사용합니다. */
function resolveActiveWeek(
  weeks: ReadonlySet<number>,
  branchWeek: number | undefined,
): number | undefined {
  if (weeks.size === 1) return [...weeks][0];
  if (weeks.size === 0) return branchWeek;
  return undefined;
}

/** 로컬 이력 조회 실패·파일 검사 실패·대체 기준 사용 여부에 맞는 안내를 반환합니다. */
function describeLocalHistoryProblem(
  history: LocalSubmissionHistorySnapshot,
  inspectionFailed: boolean,
): string | undefined {
  if (history.status === 'unavailable') {
    return history.reason ?? '로컬 커밋 기록을 확인할 수 없습니다.';
  }
  if (inspectionFailed) {
    return '일부 로컬 커밋의 변경 파일을 확인할 수 없어 push할 수 없습니다.';
  }
  if (history.usedLocalMainFallback) {
    return '공식 remote를 확인할 수 없어 로컬 main 기준으로만 커밋을 표시합니다.';
  }
  return undefined;
}

/** 먼저 해결할 사유의 기존 우선순위를 유지합니다. 로컬 검증 실패가 원격 상태보다 우선합니다. */
function describeSubmissionBlock({
  localBlockedReason,
  remote,
  hasOtherOpenPullRequest,
  otherStagedFiles,
  mixedWeeks,
  branchAllowed,
}: {
  localBlockedReason: string | undefined;
  remote: RemoteSubmissionState;
  hasOtherOpenPullRequest: boolean;
  otherStagedFiles: readonly string[];
  mixedWeeks: boolean;
  branchAllowed: boolean;
}): string | undefined {
  if (localBlockedReason !== undefined) return localBlockedReason;
  if (remote.compareIncomplete) {
    return 'GitHub 조회 한도로 origin 변경 파일을 모두 확인할 수 없어 제출할 수 없습니다.';
  }
  if (remote.openPullRequestCount > 1) {
    return '열린 주차 PR이 여러 개입니다. GitHub에서 하나만 남겨 주세요.';
  }
  if (hasOtherOpenPullRequest) {
    return '다른 주차 PR이 끝나기 전에는 현재 주차를 제출할 수 없습니다.';
  }
  if (otherStagedFiles.length > 0) {
    return '풀이 외 파일이 스테이징되어 있습니다. 해당 파일을 먼저 스테이징 해제해 주세요.';
  }
  if (mixedWeeks) {
    return '공식 저장소에 반영되지 않은 풀이가 여러 주차에 걸쳐 있습니다.';
  }
  if (!branchAllowed) {
    return '제출 기능은 main 또는 활성 week-XX 브랜치에서만 사용할 수 있습니다.';
  }
  return undefined;
}

/** 같은 SHA가 로컬·원격에 모두 있으면 pushed 정보를 우선하며 원래 삽입 순서는 유지합니다. */
function mergeSubmissionCommits(
  remoteCommits: SubmissionCommitSnapshot[],
  localCommits: SubmissionCommitSnapshot[],
): SubmissionCommitSnapshot[] {
  const commitsByHash = new Map<string, SubmissionCommitSnapshot>();
  for (const commit of [...remoteCommits, ...localCommits]) {
    const existing = commitsByHash.get(commit.hash);
    commitsByHash.set(commit.hash, existing?.pushed ? existing : commit);
  }
  return [...commitsByHash.values()];
}

/** 스테이징·커밋·포크 파일 전체의 주차를 집계합니다. 파일에 주차가 없을 때만 브랜치 번호로 대체합니다. */
function activeSubmissionScope(
  stagedFiles: SubmissionFileSnapshot[],
  commits: SubmissionCommitSnapshot[],
  forkFiles: SubmissionFileSnapshot[],
  submissionBranch: string | undefined,
) {
  const activeFiles = [
    ...stagedFiles,
    ...commits.flatMap(({ files: commitFiles }) => commitFiles),
    ...forkFiles,
  ];
  const activeWeeks = new Set(
    activeFiles.map(({ week }) => week).filter((week): week is number => week !== undefined),
  );
  return {
    activeSubmissionWeek: resolveActiveWeek(activeWeeks, weekFromBranch(submissionBranch)),
    mixedWeeks: activeWeeks.size > 1,
  };
}

/** 동기화와 main 복귀는 서로 다른 작업 파일 조건을 사용합니다. 표시용 조건을 실제 쓰기 검증과 혼동하지 않습니다. */
function submissionPermissions(context: LocalSubmissionContext, input: ReadySubmissionInput) {
  const { branch, blockingTrackedFiles, currentBranchWeek, local } = context;
  const {
    remote,
    rebaseInProgress,
    hasBlockingOriginCommits,
    hasDirtyTrackedState,
    hasUntrackedChanges,
  } = input;
  const blocksForkSync = trackedFilesBlockSync(blockingTrackedFiles);
  /** 포크 동기화는 풀이의 작업 트리 수정까지 모두 금지하지 않습니다. 추적 파일 분류와 미푸시 main 상태로 판단합니다. */
  const canSync =
    branch === 'main' && !blocksForkSync && !rebaseInProgress && !hasBlockingOriginCommits;
  const syncDisabledReason = describeSyncDisabledReason(
    branch,
    blockingTrackedFiles,
    Boolean(rebaseInProgress),
    hasBlockingOriginCommits,
  );
  const latestPullRequestStatus = remote.latestPullRequest
    ? pullRequestStatus(remote.latestPullRequest)
    : undefined;
  /** 주차 브랜치에서 main으로 이동하는 조건은 더 엄격합니다. 병합 완료뿐 아니라 untracked 포함 작업 상태도 확인합니다. */
  const canReturnToMain =
    currentBranchWeek !== undefined &&
    latestPullRequestStatus === 'merged' &&
    !hasDirtyTrackedState &&
    !hasUntrackedChanges &&
    !rebaseInProgress &&
    local.commits.length === 0;
  return { canSync, syncDisabledReason, canReturnToMain };
}
