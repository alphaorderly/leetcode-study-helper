import type { CurrentProblemSnapshot, ExtensionSnapshot } from '../../shared/contracts';
import type { UiState } from './viewTypes';

/** 워크스페이스에 표시할 저장소가 있는지 판별합니다. */
export function hasRepositories(state: ExtensionSnapshot | undefined): boolean {
  return (state?.repositories.length ?? 0) > 0;
}

/** 닉네임 미설정과 지원 저장소 미발견 안내 문구를 반환합니다. */
export function shellNotices(state: ExtensionSnapshot | undefined): string[] {
  const notices: string[] = [];
  if (!state?.nickname) {
    notices.push('닉네임과 기본 언어를 설정하면 내 풀이를 찾을 수 있습니다.');
  }
  if (state && state.repositories.length === 0) {
    notices.push(
      '지원되는 워크스페이스를 찾지 못했습니다. problem-categories.json과 문제 폴더가 있는 저장소를 열어 주세요.',
    );
  }
  return notices;
}

/** 줄 끝 보정 버튼의 비활성 여부와 안내 문구를 계산합니다. */
export function lintActionModel(
  state: ExtensionSnapshot,
  ui: UiState,
): { disabled: boolean; title?: string } {
  const eligibleSolutionCount = state.repositories
    .flatMap(({ problems }) => problems)
    .flatMap(({ solutions }) => solutions)
    .filter(({ name }) => !name.endsWith('.md')).length;
  const disabled = ui.busy || !state.workspaceTrusted || eligibleSolutionCount === 0;
  if (!state.workspaceTrusted) {
    return { disabled, title: '파일을 수정하려면 워크스페이스를 신뢰해야 합니다.' };
  }
  if (eligibleSolutionCount === 0) {
    return { disabled, title: '수정할 제출 파일이 없습니다.' };
  }
  return { disabled };
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
