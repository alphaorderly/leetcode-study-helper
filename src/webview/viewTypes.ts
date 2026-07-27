import type { WebviewToExtensionMessage } from '../core/types';
import type { GroupingMode, StatusFilter } from './problemViewModel';

export type ViewMode = 'list' | 'currentProblem' | 'submission';

export interface UiState {
  query: string;
  filter: StatusFilter;
  groupBy: GroupingMode;
  unpushedOnly: boolean;
  viewMode: ViewMode;
  busy: boolean;
  submissionRepository?: string;
  commitMessages?: Record<string, string>;
}

export type PostMessage = (message: WebviewToExtensionMessage) => void;
