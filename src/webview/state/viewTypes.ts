import type { ExtensionSnapshot, WebviewToExtensionMessage } from '../../shared/contracts';
import type { GroupingMode, StatusFilter } from './problemViewModel';

/** 웹뷰에서 선택할 문제 목록·현재 문제·제출 화면을 구분합니다. */
export type ViewMode = 'list' | 'currentProblem' | 'submission';

/**
 * 브라우저에서 보관하는 가변 UI 상태입니다. 호스트가 공급하는 ExtensionSnapshot과 구분합니다.
 * submissionRepository는 선택한 저장소 URI이며 commitMessages는 저장소·주차별 입력값입니다.
 * 선택값이 없거나 이전 저장 상태에 필드가 없을 때는 각 모델이 기본값을 적용합니다.
 */
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

/**
 * 렌더 호출 시점의 호스트 스냅샷과 같은 UiState 객체, 명령 전송 함수를 묶습니다.
 * 모델은 표시 조건을 계산하고, 뷰의 사용자 이벤트는 ui를 갱신하거나 post로 호스트에 요청합니다.
 */
export interface ViewContext {
  state: ExtensionSnapshot;
  ui: UiState;
  post: PostMessage;
}
