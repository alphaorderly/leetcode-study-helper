import type { CurrentProblemSnapshot, ExtensionSnapshot } from '../../shared/contracts';
import type { UiState } from './viewTypes';

/** 워크스페이스에 표시할 저장소가 있는지 판별합니다. */
export function hasRepositories(state: ExtensionSnapshot | undefined): boolean {
  return (state?.repositories.length ?? 0) > 0;
}

/** 현재 문제 탭의 비활성 여부와 안내 문구를 반환합니다. */
export function currentProblemTabModel(currentProblem: CurrentProblemSnapshot | undefined): {
  disabled: boolean;
  title?: string;
} {
  if (!currentProblem) {
    return { disabled: true, title: '풀이 파일을 열면 현재 문제를 볼 수 있습니다.' };
  }
  return { disabled: false };
}

/** 제출 화면에서 목록 전용 컨트롤을 숨길지 반환합니다. */
export function listChromeHidden(ui: UiState): boolean {
  return ui.viewMode === 'submission';
}
