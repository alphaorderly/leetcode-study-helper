import type {
  BlockingTrackedFile,
  PullRequestSnapshot,
  RepositorySnapshot,
  RepositorySubmissionSnapshot,
  WebviewToExtensionMessage,
} from '../../shared/contracts';
import type { UiState } from './viewTypes';

/** 제출 그래프 렌더에 공유하는 파생 플래그입니다. */
export interface SubmissionGraphFacts {
  pullRequest: PullRequestSnapshot | undefined;
  hasUnpushed: boolean;
  remoteUnavailable: boolean;
  blocked: boolean;
  hasStaged: boolean;
  hasLocalWork: boolean;
  hasTimeline: boolean;
  needsOfficialSync: boolean;
  showSyncIssue: boolean;
}

/** 제출 그래프가 그릴 화면 종류입니다. unavailable은 레이아웃이 아니라 배너로 다룹니다. */
export type SubmissionGraphLayout =
  | { type: 'loading'; title: string; description?: string }
  | { type: 'unsupported'; reason: string }
  | { type: 'auth-only'; reason: string; needsSignIn: boolean }
  | { type: 'empty-sync' }
  | { type: 'empty-idle' }
  | { type: 'timeline' };

/** 그래프 버튼의 표시 문구와 비활성 이유, 전송 메시지입니다. */
export interface GraphAction {
  label: string;
  disabled: boolean;
  title?: string;
  message: WebviewToExtensionMessage;
}

/** 동기화를 막는 파일을 종류별로 나눈 표시 모델입니다. */
export interface BlockingFilesModel {
  otherFiles: BlockingTrackedFile[];
  stagedSolutions: BlockingTrackedFile[];
  conflicts: BlockingTrackedFile[];
}

const DEFAULT_SYNC_DISABLED = '스테이징·풀이 외 추적 파일 수정과 미푸시 커밋을 먼저 정리해 주세요.';

/** 제출 스냅샷에서 그래프가 반복 계산하던 플래그를 한 번만 만듭니다. */
export function submissionGraphFacts(
  submission: RepositorySubmissionSnapshot,
): SubmissionGraphFacts {
  const pullRequest = submission.pullRequest ?? submission.activePullRequest;
  const hasUnpushed = submission.pendingCommits.some(({ pushed }) => !pushed);
  const hasStaged = submission.stagedFiles.length > 0;
  const hasOtherStaged = submission.otherStagedFiles.length > 0;
  return {
    pullRequest,
    hasUnpushed,
    remoteUnavailable: submission.status === 'unavailable',
    blocked: Boolean(submission.blockedReason),
    hasStaged,
    hasLocalWork: hasStaged || hasOtherStaged || hasUnpushed,
    hasTimeline:
      hasStaged ||
      hasOtherStaged ||
      submission.pendingCommits.length > 0 ||
      submission.forkFiles.length > 0 ||
      submission.otherForkFiles.length > 0 ||
      Boolean(pullRequest),
    needsOfficialSync: !submission.hasCanonicalRemote || submission.behindOfficialMain,
    showSyncIssue:
      submission.behindOfficialMain &&
      !submission.canSync &&
      Boolean(submission.syncDisabledReason),
  };
}

/**
 * 제출 그래프의 최상위 화면을 우선순위대로 결정합니다.
 * 원격 조회 실패라도 로컬 작업이 있으면 타임라인과 인증 배너를 함께 표시합니다.
 * 따라서 unavailable을 항상 오류 전용 화면으로 바꾸면 로컬 커밋 정보가 가려집니다.
 */
export function submissionGraphLayout(
  submission: RepositorySubmissionSnapshot | undefined,
): SubmissionGraphLayout {
  if (!submission || submission.status === 'checking') {
    return {
      type: 'loading',
      title: '제출 상태를 확인하는 중…',
      description: submission ? '포크, 커밋과 PR 상태를 불러오고 있습니다.' : undefined,
    };
  }
  if (submission.status === 'unsupported') {
    return {
      type: 'unsupported',
      reason:
        submission.fork.reason ??
        'DaleStudy/leetcode-study 포크에서만 제출 기능을 사용할 수 있습니다.',
    };
  }
  const facts = submissionGraphFacts(submission);
  if (submission.status === 'unavailable' && !facts.hasLocalWork) {
    return {
      type: 'auth-only',
      reason: submission.fork.reason ?? 'GitHub 원격 상태를 확인할 수 없습니다.',
      needsSignIn: Boolean(submission.fork.needsGitHubSignIn),
    };
  }
  if (!facts.hasTimeline) {
    return facts.needsOfficialSync ? { type: 'empty-sync' } : { type: 'empty-idle' };
  }
  return { type: 'timeline' };
}

/** GitHub를 읽지 못했을 때 그래프 위에 올릴 로그인 안내를 반환합니다. */
export function submissionAuthBanner(submission: RepositorySubmissionSnapshot):
  | {
      reason: string;
      needsSignIn: boolean;
    }
  | undefined {
  if (submission.status !== 'unavailable') {
    return undefined;
  }
  return {
    reason: submission.fork.reason ?? 'GitHub 원격 상태를 확인할 수 없습니다.',
    needsSignIn: Boolean(submission.fork.needsGitHubSignIn),
  };
}

/** 이력 조회 실패, 차단 사유, 로컬 main 대체 안내 문구를 모읍니다. */
export function submissionNoticeTexts(submission: RepositorySubmissionSnapshot): string[] {
  const notices: string[] = [];
  if (submission.localHistory?.status === 'unavailable') {
    notices.push(submission.localHistory.reason ?? '로컬 커밋 기록을 확인할 수 없습니다.');
  } else if (submission.localHistory?.usedLocalMainFallback) {
    notices.push(
      submission.localHistory.reason ?? '공식 remote가 없어 로컬 main 기준으로 커밋을 표시합니다.',
    );
  }
  if (submission.blockedReason) {
    notices.push(submission.blockedReason);
  }
  return notices;
}

/** 충돌·스테이징·풀이 외 변경 중 사용자에게 안내할 차단 파일을 고릅니다. */
export function blockingFilesModel(
  files: readonly BlockingTrackedFile[] | undefined,
): BlockingFilesModel | undefined {
  const displayed = (files ?? []).filter(
    (file) => file.state === 'conflict' || file.state === 'staged' || file.kind === 'other',
  );
  if (displayed.length === 0) {
    return undefined;
  }
  return {
    otherFiles: displayed.filter((file) => file.kind === 'other' && file.state !== 'conflict'),
    stagedSolutions: displayed.filter(
      (file) => file.kind === 'solution' && file.state === 'staged',
    ),
    conflicts: displayed.filter((file) => file.state === 'conflict'),
  };
}

/** 원격 쓰기 버튼을 busy·조회 실패·차단 상태로 막을지 판별합니다. */
export function remoteWriteDisabled(
  ui: UiState,
  facts: SubmissionGraphFacts,
  extra = false,
): boolean {
  return ui.busy || facts.remoteUnavailable || facts.blocked || extra;
}

/** PR 상태 배지에 쓸 짧은 문구를 반환합니다. */
export function pullRequestStatusLabel(status: PullRequestSnapshot['status']): string {
  switch (status) {
    case 'merged':
      return '병합 완료';
    case 'closed-unmerged':
      return '종료됨 · 미병합';
    default:
      return '검토 중';
  }
}

/** PR 열기 또는 작성 화면 버튼의 활성 조건을 계산합니다. */
export function pullRequestAction(
  rootUri: string,
  submission: RepositorySubmissionSnapshot,
  facts: SubmissionGraphFacts,
  ui: UiState,
): GraphAction {
  const existing = facts.pullRequest;
  return {
    label: existing ? 'GitHub에서 열기' : 'PR 작성 화면 열기',
    disabled: existing
      ? ui.busy
      : remoteWriteDisabled(ui, facts, facts.hasUnpushed || submission.forkFiles.length === 0),
    title: !existing && facts.hasUnpushed ? '로컬 커밋을 origin에 먼저 push해 주세요.' : undefined,
    message: { type: 'openPullRequest', rootUri },
  };
}

/** origin push 버튼의 활성 조건을 계산합니다. */
export function pushAction(rootUri: string, facts: SubmissionGraphFacts, ui: UiState): GraphAction {
  return {
    label: 'origin에 push',
    disabled: remoteWriteDisabled(ui, facts),
    title: facts.remoteUnavailable ? 'GitHub 원격 상태를 확인한 뒤 push할 수 있습니다.' : undefined,
    message: { type: 'pushActiveWeek', rootUri },
  };
}

/** 주차 커밋 버튼의 활성 조건을 계산합니다. */
export function commitAction(
  rootUri: string,
  facts: SubmissionGraphFacts,
  ui: UiState,
): GraphAction {
  return {
    label: '이 주차 커밋',
    disabled: remoteWriteDisabled(ui, facts),
    message: { type: 'commitActiveWeek', rootUri, message: '' },
  };
}

/** 빈 제출 화면의 포크 맞추기 버튼 활성 조건을 계산합니다. */
export function emptySyncAction(
  rootUri: string,
  submission: RepositorySubmissionSnapshot,
  ui: UiState,
): GraphAction {
  return {
    label: '지금 맞추기',
    disabled: ui.busy || !submission.canSync,
    title: submission.canSync
      ? undefined
      : (submission.syncDisabledReason ?? DEFAULT_SYNC_DISABLED),
    message: { type: 'syncFork', rootUri },
  };
}

/** 제출 헤더의 새로고침·동기화·main 복귀 버튼 상태를 계산합니다. */
export function submissionHeaderActions(
  repository: RepositorySnapshot,
  ui: UiState,
): {
  refresh: GraphAction;
  sync: GraphAction;
  returnToMain?: GraphAction;
} {
  const submission = repository.submission;
  const rootUri = repository.rootUri;
  return {
    refresh: {
      label: '새로고침',
      disabled: ui.busy,
      message: { type: 'refreshSubmission' },
    },
    sync: {
      label: '포크 동기화',
      disabled: ui.busy || !submission?.canSync,
      title: submission?.canSync
        ? '공식 main 가져오기'
        : (submission?.syncDisabledReason ?? DEFAULT_SYNC_DISABLED),
      message: { type: 'syncFork', rootUri },
    },
    returnToMain: isWeekBranch(submission?.branch)
      ? {
          label: 'main으로 돌아가 동기화',
          disabled: ui.busy || !submission?.canReturnToMain,
          title: submission?.canReturnToMain
            ? undefined
            : 'PR 병합과 깨끗한 주차 브랜치 상태를 먼저 확인해 주세요.',
          message: { type: 'returnToMainAndSync', rootUri },
        }
      : undefined,
  };
}

/** 주차 브랜치 이름인지 판별합니다. */
export function isWeekBranch(branch: string | undefined): boolean {
  return /^week-\d{2}$/.test(branch ?? '');
}

/** 선택한 제출 저장소를 찾고 없으면 검증된 포크 또는 첫 저장소를 고릅니다. */
export function resolveSubmissionRepository(
  repositories: readonly RepositorySnapshot[],
  selectedRootUri: string | undefined,
): RepositorySnapshot | undefined {
  return (
    repositories.find(({ rootUri }) => rootUri === selectedRootUri) ??
    repositories.find(({ submission }) => submission?.fork.status === 'verified') ??
    repositories[0]
  );
}

/**
 * 같은 주차를 가진 서로 다른 저장소의 입력을 분리하기 위해 URI와 주차를 NUL로 연결합니다.
 * 주차를 결정하지 못한 경우 unknown 슬롯을 사용하며 이 키는 Git 브랜치 이름이 아닙니다.
 */
export function commitMessageKey(rootUri: string, week: number | undefined): string {
  return `${rootUri}\u0000${week ?? 'unknown'}`;
}

/** 닉네임과 주차를 반영한 기본 커밋 메시지를 만듭니다. */
export function defaultCommitMessage(nickname: string, week: number | undefined): string {
  return week
    ? `[${nickname}] WEEK ${String(week).padStart(2, '0')} Solutions`
    : `[${nickname}] Solutions`;
}

/** 주차 번호를 두 자리 Week 표기로 바꿉니다. */
export function weekPad(week: number): string {
  return String(week).padStart(2, '0');
}
