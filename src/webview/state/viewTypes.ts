import type { WebviewToExtensionMessage } from '../../shared/contracts';
import type { GroupingMode, StatusFilter } from './problemViewModel';

/** 웹뷰에서 선택할 문제 목록·현재 문제·제출 화면을 구분합니다. */
export type ViewMode = 'list' | 'currentProblem' | 'submission';

/** 웹뷰가 보관하는 필터·탭·작업 중 여부와 저장소별 커밋 입력 상태입니다. */
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

/** 확장 호스트로 타입이 지정된 사용자 명령을 보내는 함수 계약입니다. */
export type PostMessage = (message: WebviewToExtensionMessage) => void;
