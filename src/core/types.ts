export interface ProblemMetadata {
  difficulty: string;
  categories: string[];
  blindCategories: string[];
  intendedApproach?: string;
}

export type ProblemCatalog = Record<string, ProblemMetadata>;

export type SolutionGitStatus = 'pushed' | 'unpushed' | 'unknown';

export interface SolutionFileSnapshot {
  name: string;
  uri: string;
  gitStatus: SolutionGitStatus;
}

export interface ProblemSnapshot extends ProblemMetadata {
  slug: string;
  week?: number;
  completed: boolean;
  solutions: SolutionFileSnapshot[];
}

export interface RepositorySnapshot {
  name: string;
  rootUri: string;
  gitRemote?: string;
  problems: ProblemSnapshot[];
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
  | { type: 'openProblem'; slug: string }
  | { type: 'loadCurrentProblem' }
  | { type: 'runCurrentSolution'; candidateId: string }
  | { type: 'deleteSolution'; uri: string }
  | { type: 'fixAllSolutions' }
  | { type: 'createSolution'; rootUri: string; slug: string };

export type ExtensionToWebviewMessage =
  | { type: 'state'; state: ExtensionSnapshot }
  | { type: 'currentProblem'; currentProblem?: CurrentProblemSnapshot }
  | { type: 'busy'; value: boolean };
