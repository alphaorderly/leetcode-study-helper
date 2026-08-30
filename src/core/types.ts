export interface ProblemMetadata {
  difficulty: string;
  categories: string[];
  blindCategories: string[];
  intendedApproach?: string;
}

export type ProblemCatalog = Record<string, ProblemMetadata>;

export type SolutionGitStatus = 'checking' | 'pushed' | 'unpushed' | 'unknown';

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

export interface SolutionFileSnapshot {
  name: string;
  uri: string;
  gitStatus: SolutionGitStatus;
  submissionStatus?: SolutionSubmissionStatus;
  pullRequestNumber?: number;
}

export interface ProblemSnapshot extends ProblemMetadata {
  slug: string;
  week?: number;
  solutionUrl?: string;
  completed: boolean;
  hasOtherSolutions: boolean;
  solutions: SolutionFileSnapshot[];
}

export interface RepositorySnapshot {
  name: string;
  rootUri: string;
  gitRemote?: string;
  problems: ProblemSnapshot[];
  submission?: RepositorySubmissionSnapshot;
}

export interface SubmissionFileSnapshot {
  name: string;
  uri: string;
  relativePath: string;
  slug: string;
  week?: number;
}

export interface SubmissionCommitSnapshot {
  hash: string;
  shortHash: string;
  message: string;
  pushed: boolean;
  files: SubmissionFileSnapshot[];
  otherFiles: string[];
}

export interface PullRequestSnapshot {
  number: number;
  title: string;
  url: string;
  week?: number;
  branch: string;
  status: 'open' | 'merged' | 'closed-unmerged';
}

export type ForkVerificationStatus =
  | 'checking'
  | 'verified'
  | 'unsupported'
  | 'unavailable';

export interface ForkIdentitySnapshot {
  status: ForkVerificationStatus;
  owner?: string;
  repository?: string;
  originUrl?: string;
  reason?: string;
  needsGitHubSignIn?: boolean;
}

export interface SubmissionSummary {
  working: number;
  staged: number;
  pushNeeded: number;
  prPending: number;
  merged: number;
  unknown: number;
}

export interface BlockingTrackedFile {
  relativePath: string;
  kind: 'solution' | 'other';
  state: 'staged' | 'modified' | 'conflict';
}

export interface RepositorySubmissionSnapshot {
  status: 'checking' | 'ready' | 'unsupported' | 'blocked' | 'unavailable';
  branch?: string;
  submissionBranch?: string;
  activeSubmissionWeek?: number;
  fork: ForkIdentitySnapshot;
  stagedFiles: SubmissionFileSnapshot[];
  otherStagedFiles: string[];
  pendingCommits: SubmissionCommitSnapshot[];
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

export interface ProblemTopicTag {
  name: string;
  slug: string;
}

export interface LeetCodeProblemDetail {
  questionId: string;
  title: string;
  titleSlug: string;
  content?: string;
  difficulty: string;
  isPaidOnly: boolean;
  topicTags: ProblemTopicTag[];
}

interface CurrentProblemBase {
  rootUri: string;
  slug: string;
  solution: SolutionFileSnapshot;
  runner: PythonRunnerSnapshot;
}

export interface PythonSolutionCandidate {
  id: string;
  label: string;
  classLine: number;
  methodLine: number;
}

interface PythonRunnerWithCandidates {
  candidates: PythonSolutionCandidate[];
  selectedCandidateId: string;
}

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

export type CurrentProblemSnapshot =
  | (CurrentProblemBase & { status: 'idle' })
  | (CurrentProblemBase & { status: 'loading' })
  | (CurrentProblemBase & { status: 'loaded'; detail: LeetCodeProblemDetail })
  | (CurrentProblemBase & { status: 'error'; message: string });

export interface DetectionIssue {
  rootName: string;
  message: string;
}

export interface LanguageOption {
  id: string;
  label: string;
  extension: string;
}

export interface ExtensionSnapshot {
  nickname: string;
  preferredLanguage: string;
  languages: LanguageOption[];
  repositories: RepositorySnapshot[];
  issues: DetectionIssue[];
  workspaceTrusted: boolean;
  currentProblem?: CurrentProblemSnapshot;
}

export interface LineLintFixResult {
  checked: number;
  fixed: number;
  ignored: number;
}

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

export type ExtensionToWebviewMessage =
  | { type: 'state'; state: ExtensionSnapshot }
  | { type: 'currentProblem'; currentProblem?: CurrentProblemSnapshot }
  | { type: 'busy'; value: boolean };
