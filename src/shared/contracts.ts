/** 카탈로그에서 읽은 문제 난이도, 분류와 의도된 풀이 접근법입니다. */
export interface ProblemMetadata {
  difficulty: string;
  categories: string[];
  blindCategories: string[];
  intendedApproach?: string;
}

/** 문제 slug를 키로 사용하는 메타데이터 목록입니다. */
export type ProblemCatalog = Record<string, ProblemMetadata>;

/**
 * 현재 브랜치의 upstream 기준으로 로컬 변경의 반영 여부를 표시합니다.
 * pushed는 공식 저장소 병합 완료를 뜻하지 않습니다. checking은 조회 대기·진행 중이고,
 * unknown은 upstream이나 조회 근거가 없어 판단하지 못한 상태입니다.
 */
export type SolutionGitStatus = 'checking' | 'pushed' | 'unpushed' | 'unknown';

/**
 * 주차 제출 흐름에서 파일의 현재 위치입니다.
 * working → staged → push-needed → pr-needed/pr-open → merged 순서의 표시가 기본입니다.
 * staged-outdated는 index에 올린 뒤 파일이 다시 수정된 상태라 재스테이징이 필요합니다.
 * sync-needed는 동기화 후 반영 여부를 다시 확인해야 한다는 뜻입니다.
 * checking은 조회 중, unknown은 근거 부족이며 둘 다 미제출 확정 상태가 아닙니다.
 */
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

/**
 * 파일 URI를 기준으로 편집기 선택·화면 명령과 연결하는 풀이 스냅샷입니다.
 * submissionStatus가 없으면 주차 제출 정보가 아직 결합되지 않은 상태입니다.
 * pullRequestNumber는 연결된 열린 PR을 확인한 경우에만 제공됩니다.
 */
export interface SolutionFileSnapshot {
  name: string;
  uri: string;
  gitStatus: SolutionGitStatus;
  submissionStatus?: SolutionSubmissionStatus;
  pullRequestNumber?: number;
}

/**
 * 카탈로그와 파일 탐색 결과를 합친 문제 상태입니다. completed는 내 풀이 파일이
 * 존재한다는 뜻이며 정답 통과 여부가 아닙니다. week는 주차표에 없으면 생략되고,
 * solutionUrl은 README에서 허용된 정답 링크를 찾지 못하면 생략됩니다.
 */
export interface ProblemSnapshot extends ProblemMetadata {
  slug: string;
  week?: number;
  solutionUrl?: string;
  completed: boolean;
  hasOtherSolutions: boolean;
  solutions: SolutionFileSnapshot[];
}

/**
 * 하나의 워크스페이스 루트에서 탐색한 문제 목록입니다. rootUri는 저장소 선택의 키입니다.
 * gitRemote는 현재 upstream 이름이며, submission이 없으면 제출 조회 결과가 아직 없습니다.
 * 갱신 세션은 이 객체를 직접 수정하지 않고 새 목록으로 교체해 조회 기준을 구분합니다.
 */
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

/**
 * 화면에 표시할 커밋과 풀이·기타 파일 분류입니다. pushed는 원격 이력에서 확보한 커밋 여부입니다.
 * fileInspectionStatus가 unavailable이면 files가 비어 있어도 변경 없는 커밋으로 간주하지 않습니다.
 * 선택적 검사 필드는 아직 검사 정보를 담지 않은 스냅샷과의 호환을 위해 남겨 둡니다.
 */
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

/**
 * origin이 지원하는 공식 저장소의 포크인지 조회한 결과입니다.
 * unsupported는 대상 조건 불일치이고 unavailable은 조회 실패이므로 재시도로 달라질 수 있습니다.
 * owner·repository·originUrl은 URL을 해석한 경우에만 있고, needsGitHubSignIn은 로그인 안내용입니다.
 */
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

/**
 * 웹뷰의 제출 그래프와 버튼을 위한 조회 시점의 스냅샷입니다. 실제 Git 쓰기 승인 정보가 아닙니다.
 * checking은 조회 중, unavailable은 필요한 조회 실패, unsupported는 대상 조건 불일치,
 * blocked는 우선순위에 따라 선택한 제출 차단 사유가 있는 상태입니다. ready여도 쓰기 전 재검증합니다.
 * branch는 현재 로컬 브랜치이고 submissionBranch는 원격 PR 등을 반영한 제출 대상입니다.
 * activeSubmissionWeek는 한 주차로 결정되지 않으면 없을 수 있습니다. pendingCommits에는
 * 표시용으로 합친 pushed 커밋도 들어가므로 미푸시 여부는 각 항목의 pushed를 확인합니다.
 */
export interface RepositorySubmissionSnapshot {
  status: 'checking' | 'ready' | 'unsupported' | 'blocked' | 'unavailable';
  branch?: string;
  submissionBranch?: string;
  activeSubmissionWeek?: number;
  fork: ForkIdentitySnapshot;
  stagedFiles: SubmissionFileSnapshot[];
  otherStagedFiles: string[];
  pendingCommits: SubmissionCommitSnapshot[];
  /** 로컬 이력 조회 결과입니다. undefined는 이력이 빈 것이 아니라 해당 정보가 제공되지 않은 상태입니다. */
  localHistory?: LocalSubmissionHistorySnapshot;
  /** 공식 main과 원격 주차 브랜치 비교에서 찾은 내 풀이입니다. 원격 조회 실패 시 빈 배열일 수 있어 status와 함께 읽습니다. */
  forkFiles: SubmissionFileSnapshot[];
  otherForkFiles: string[];
  /** 현재 열린 PR입니다. 닫힌 PR의 병합·종료 상태를 표시할 때는 pullRequest를 사용합니다. */
  activePullRequest?: PullRequestSnapshot;
  /** 선택된 브랜치의 최근 PR로, 병합되거나 미병합 종료된 PR도 포함합니다. 부재만으로 미제출을 확정하지 않습니다. */
  pullRequest?: PullRequestSnapshot;
  /** 제출 차단 또는 조회 실패를 설명할 우선 사유입니다. undefined여도 서비스의 쓰기 직전 검증은 필요합니다. */
  blockedReason?: string;
  summary: SubmissionSummary;
  /** 화면에서 포크 동기화를 제안할 수 있는지입니다. 사용자가 누른 시점의 실제 Git 상태는 서비스가 다시 확인합니다. */
  canSync: boolean;
  /** 병합된 주차 브랜치에서 main 복귀를 제안할 수 있는지입니다. canSync와 작업 파일 허용 조건이 다릅니다. */
  canReturnToMain: boolean;
  hasCanonicalRemote: boolean;
  behindOfficialMain: boolean;
  /** 동기화에 한정한 비활성 이유입니다. 일반 제출 차단 사유와 동시에 존재할 수 있습니다. */
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

/**
 * Python AST가 찾은 실행 후보입니다. id의 cNmM은 Solution 클래스와 같은 이름 메서드의
 * 0부터 시작하는 등장 순서입니다. 위치 표시는 1부터 시작하는 소스 줄 번호입니다.
 * 소스를 편집하면 식별자가 달라질 수 있어 이전 분석 결과로 실행하지 않아야 합니다.
 */
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

/**
 * 설명 로딩과 독립적으로 갱신되는 로컬 Python 분석·실행 상태입니다.
 * checking은 분석 대기·진행 중, unavailable은 신뢰·파일 형식·데이터·객체 조건으로 실행 불가입니다.
 * failed는 assert 실패, error는 분석·프로세스·실행 오류입니다. 실행 중 오류는 후보를 보존하지만
 * 분석 오류는 후보가 없을 수 있으므로 status와 candidates 유무를 확인한 뒤 접근합니다.
 */
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

/**
 * status는 LeetCode 설명 조회 상태이고 runner.status는 Python 상태입니다. 둘을 혼동하지 않습니다.
 * idle은 아직 설명 요청 전이며 loaded일 때만 detail이 있습니다. 설명은 slug별로 캐시하지만
 * solution과 runner는 현재 파일을 가리킵니다.
 */
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

/**
 * StudyController가 조립해 웹뷰에 보내는 전체 상태입니다. 현재 문제 변경은 별도 메시지로도
 * 전달되어 관련 없는 목록·제출 입력 DOM을 유지합니다. currentProblem 부재는 등록된 풀이를
 * 선택하지 않았다는 뜻이며, 설명 조회 중이라는 뜻이 아닙니다.
 */
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

/**
 * 브라우저에서 확장 호스트로 보내는 사용자 명령입니다. URI는 문자열로 전달합니다.
 * 메시지에 담긴 파일·주차는 요청 값일 뿐이며 컨트롤러와 Git 서비스가 대상과 현재 상태를 검증합니다.
 * 타입 선언만으로 런타임 payload가 검증되는 것은 아닙니다.
 */
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
