/** 카탈로그에서 읽은 문제 난이도, 분류와 의도된 풀이 접근법입니다. */
export interface ProblemMetadata {
  difficulty: string;
  categories: string[];
  blindCategories: string[];
  intendedApproach?: string;
}

/** 문제 slug를 키로 사용하는 메타데이터 목록입니다. */
export type ProblemCatalog = Record<string, ProblemMetadata>;

/** 현재 upstream에 풀이의 로컬 변경이 반영되었는지를 나타내는 조회 상태입니다. */
export type SolutionGitStatus = 'checking' | 'pushed' | 'unpushed' | 'unknown';

/** 풀이의 주차 제출 단계입니다. staged-outdated는 스테이징 이후 추가 수정된 상태입니다. */
export type SolutionSubmissionStatus =
  | 'checking'
  | 'working'
  | 'staged'
  | 'staged-outdated'
  | 'push-needed'
  | 'pr-needed'
  | 'pr-open'
  | 'merged'
  | 'sync-needed'
  | 'conflict'
  | 'unknown';

/** 웹뷰에서 사용하는 풀이 파일 식별자와 Git·제출 상태입니다. */
export interface SolutionFileSnapshot {
  name: string;
  uri: string;
  gitStatus: SolutionGitStatus;
  submissionStatus?: SolutionSubmissionStatus;
  pullRequestNumber?: number;
}

/** 카탈로그 메타데이터에 주차와 현재 닉네임의 풀이 목록을 결합한 문제 상태입니다. */
export interface ProblemSnapshot extends ProblemMetadata {
  slug: string;
  week?: number;
  solutionUrl?: string;
  completed: boolean;
  hasOtherSolutions: boolean;
  solutions: SolutionFileSnapshot[];
}

/** 하나의 워크스페이스 루트에 대한 문제 목록과 제출 상태입니다. */
export interface RepositorySnapshot {
  name: string;
  rootUri: string;
  gitRemote?: string;
  problems: ProblemSnapshot[];
  submission?: RepositorySubmissionSnapshot;
}

/** 제출 대상 파일의 URI, 저장소 상대 경로와 소속 문제·주차입니다. */
export interface SubmissionFileSnapshot {
  name: string;
  uri: string;
  relativePath: string;
  slug: string;
  week?: number;
}

/** 표시용 커밋과 분류된 변경 파일입니다. 파일 조회 실패는 빈 성공 목록과 구분합니다. */
export interface SubmissionCommitSnapshot {
  hash: string;
  shortHash: string;
  message: string;
  pushed: boolean;
  files: SubmissionFileSnapshot[];
  otherFiles: string[];
  fileInspectionStatus?: 'ready' | 'unavailable';
  fileInspectionReason?: string;
}

/** 로컬 이력의 기준 ref·공통 조상과 조회 실패 또는 로컬 main 대체 여부입니다. */
export interface LocalSubmissionHistorySnapshot {
  status: 'ready' | 'unavailable';
  baseRef?: string;
  mergeBase?: string;
  usedLocalMainFallback?: boolean;
  reason?: string;
}

/** 주차 PR의 표시 정보입니다. 닫혔지만 병합되지 않은 상태를 병합 완료와 구분합니다. */
export interface PullRequestSnapshot {
  number: number;
  title: string;
  url: string;
  week?: number;
  branch: string;
  status: 'open' | 'merged' | 'closed-unmerged';
}

/** 포크 신원 조회 중 상태와 검증 성공·미지원·조회 실패를 구분합니다. */
export type ForkVerificationStatus = 'checking' | 'verified' | 'unsupported' | 'unavailable';

/** 공식 저장소의 포크인지 확인한 결과와 인증·조회 실패 사유입니다. */
export interface ForkIdentitySnapshot {
  status: ForkVerificationStatus;
  owner?: string;
  repository?: string;
  originUrl?: string;
  reason?: string;
  needsGitHubSignIn?: boolean;
}

/** 제출 단계별 풀이 수를 집계한 화면 요약입니다. */
export interface SubmissionSummary {
  working: number;
  staged: number;
  pushNeeded: number;
  prPending: number;
  merged: number;
  unknown: number;
}

/** 동기화를 막는 추적 파일의 경로, 풀이 여부와 변경 상태입니다. */
export interface BlockingTrackedFile {
  relativePath: string;
  kind: 'solution' | 'other';
  state: 'staged' | 'modified' | 'conflict';
}

/** 웹뷰에 전달하는 제출 상태입니다. 버튼 활성 여부는 표시용이며 Git 쓰기 전에는 재검증해야 합니다. */
export interface RepositorySubmissionSnapshot {
  status: 'checking' | 'ready' | 'unsupported' | 'blocked' | 'unavailable';
  branch?: string;
  submissionBranch?: string;
  activeSubmissionWeek?: number;
  fork: ForkIdentitySnapshot;
  stagedFiles: SubmissionFileSnapshot[];
  otherStagedFiles: string[];
  pendingCommits: SubmissionCommitSnapshot[];
  localHistory?: LocalSubmissionHistorySnapshot;
  forkFiles: SubmissionFileSnapshot[];
  otherForkFiles: string[];
  activePullRequest?: PullRequestSnapshot;
  pullRequest?: PullRequestSnapshot;
  blockedReason?: string;
  summary: SubmissionSummary;
  canSync: boolean;
  canReturnToMain: boolean;
  hasCanonicalRemote: boolean;
  behindOfficialMain: boolean;
  syncDisabledReason?: string;
  blockingTrackedFiles: BlockingTrackedFile[];
}

/** LeetCode 문제에 연결된 주제의 표시 이름과 식별자입니다. */
export interface ProblemTopicTag {
  name: string;
  slug: string;
}

/** LeetCode에서 조회한 문제 설명과 난이도·유료 여부·주제 목록입니다. */
export interface LeetCodeProblemDetail {
  questionId: string;
  title: string;
  titleSlug: string;
  content?: string;
  difficulty: string;
  isPaidOnly: boolean;
  topicTags: ProblemTopicTag[];
}

/** 현재 선택한 풀이의 식별 정보와 Python 실행 상태를 공유하는 기반 계약입니다. */
interface CurrentProblemBase {
  rootUri: string;
  slug: string;
  solution: SolutionFileSnapshot;
  runner: PythonRunnerSnapshot;
}

/** Python 소스에서 선택 가능한 풀이 후보의 식별자와 선언 위치입니다. */
export interface PythonSolutionCandidate {
  id: string;
  label: string;
  classLine: number;
  methodLine: number;
}

/** 분석된 풀이 후보 목록과 현재 선택한 후보 ID입니다. */
interface PythonRunnerWithCandidates {
  candidates: PythonSolutionCandidate[];
  selectedCandidateId: string;
}

/** 분석·실행 결과를 구분한 화면 상태입니다. 후보와 결과 필드는 status에 따라 접근합니다. */
export type PythonRunnerSnapshot =
  | { status: 'checking' }
  | { status: 'unavailable'; reason: string; missingObjects?: string[] }
  | ({ status: 'ready' } & PythonRunnerWithCandidates)
  | ({ status: 'running' } & PythonRunnerWithCandidates)
  | ({
      status: 'passed';
      passed: number;
      total: number;
      durationMs: number;
      stdout?: string;
      stderr?: string;
    } & PythonRunnerWithCandidates)
  | ({
      status: 'failed';
      passed: number;
      total: number;
      failedCase: number;
      assertion?: string;
      durationMs: number;
      stdout?: string;
      stderr?: string;
    } & PythonRunnerWithCandidates)
  | ({
      status: 'error';
      message: string;
      testCase?: number;
      traceback?: string;
      stdout?: string;
      stderr?: string;
    } & Partial<PythonRunnerWithCandidates>);

/** 현재 풀이의 설명 로딩 상태와 독립적으로 갱신되는 Python 실행 상태입니다. */
export type CurrentProblemSnapshot =
  | (CurrentProblemBase & { status: 'idle' })
  | (CurrentProblemBase & { status: 'loading' })
  | (CurrentProblemBase & { status: 'loaded'; detail: LeetCodeProblemDetail })
  | (CurrentProblemBase & { status: 'error'; message: string });

/** 워크스페이스 루트별 저장소 탐색 실패 사유입니다. */
export interface DetectionIssue {
  rootName: string;
  message: string;
}

/** 새 풀이 생성에 사용하는 언어 ID, 표시 이름과 파일 확장자입니다. */
export interface LanguageOption {
  id: string;
  label: string;
  extension: string;
}

/** 설정, 저장소와 현재 문제를 웹뷰에 전달하는 전체 상태입니다. */
export interface ExtensionSnapshot {
  nickname: string;
  preferredLanguage: string;
  languages: LanguageOption[];
  repositories: RepositorySnapshot[];
  issues: DetectionIssue[];
  workspaceTrusted: boolean;
  currentProblem?: CurrentProblemSnapshot;
}

/** 줄 끝 보정에서 검사·수정·제외한 파일 수입니다. */
export interface LineLintFixResult {
  checked: number;
  fixed: number;
  ignored: number;
}

/** 웹뷰가 확장에 요청하는 명령의 직렬화 가능한 메시지 계약입니다. */
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'saveSettings'; nickname: string; preferredLanguage: string }
  | { type: 'openSolution'; uri: string }
  | { type: 'openOtherSolution'; rootUri: string; slug: string }
  | { type: 'openProblem'; slug: string }
  | { type: 'openAnswer'; rootUri: string; slug: string }
  | { type: 'loadCurrentProblem' }
  | { type: 'runCurrentSolution'; candidateId: string }
  | { type: 'deleteSolution'; uri: string }
  | { type: 'fixAllSolutions' }
  | { type: 'createSolution'; rootUri: string; slug: string }
  | { type: 'stageSolution'; uri: string }
  | { type: 'unstageSolution'; uri: string }
  | { type: 'commitActiveWeek'; rootUri: string; message: string }
  | { type: 'pushActiveWeek'; rootUri: string }
  | { type: 'openPullRequest'; rootUri: string }
  | { type: 'syncFork'; rootUri: string }
  | { type: 'discardOtherTrackedChanges'; rootUri: string }
  | { type: 'returnToMainAndSync'; rootUri: string }
  | { type: 'refreshSubmission' }
  | { type: 'signInGitHub' };

/** 전체 상태, 현재 문제 변경과 작업 중 여부를 웹뷰에 전달하는 메시지 계약입니다. */
export type ExtensionToWebviewMessage =
  | { type: 'state'; state: ExtensionSnapshot }
  | { type: 'currentProblem'; currentProblem?: CurrentProblemSnapshot }
  | { type: 'busy'; value: boolean };
