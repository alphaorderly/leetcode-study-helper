export interface ProblemMetadata {
  difficulty: string;
  categories: string[];
  blindCategories: string[];
  intendedApproach?: string;
}

export type ProblemCatalog = Record<string, ProblemMetadata>;

export interface SolutionFileSnapshot {
  name: string;
  uri: string;
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
  problems: ProblemSnapshot[];
}

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
  | { type: 'deleteSolution'; uri: string }
  | { type: 'fixAllSolutions' }
  | { type: 'createSolution'; rootUri: string; slug: string };

export type ExtensionToWebviewMessage =
  | { type: 'state'; state: ExtensionSnapshot }
  | { type: 'busy'; value: boolean };
