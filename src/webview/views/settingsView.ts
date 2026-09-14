import { actionButton } from '../components/controls';
import { element } from '../components/dom';
import type { ViewContext } from '../state/viewTypes';

/**
 * 호스트 스냅샷으로 설정 폼을 초기화하고 제출 시 saveSettings 메시지를 보냅니다.
 * 실제 설정 검증·저장·저장소 재탐색은 호스트가 담당하며, ui.busy는 입력·버튼의 진행 표시용입니다.
 */
export function renderSettings({ state, ui, post }: ViewContext): HTMLElement {
  const form = element('form', 'settings-card');
  form.setAttribute('aria-label', '풀이 설정');

  const nicknameLabel = element('label', 'field-label', '닉네임');
  nicknameLabel.htmlFor = 'nickname';
  const nicknameInput = element('input', 'text-input');
  nicknameInput.id = 'nickname';
  nicknameInput.name = 'nickname';
  nicknameInput.required = true;
  nicknameInput.pattern = '[A-Za-z0-9-]+';
  nicknameInput.placeholder = '예: study-user';
  nicknameInput.title = '영문, 숫자, 하이픈만 사용할 수 있습니다.';
  nicknameInput.value = state.nickname;
  nicknameInput.autocomplete = 'off';

  const languageLabel = element('label', 'field-label', '기본 언어');
  languageLabel.htmlFor = 'preferred-language';
  const languageSelect = element('select', 'select-input');
  languageSelect.id = 'preferred-language';
  languageSelect.name = 'preferredLanguage';
  for (const language of state.languages) {
    const option = element('option', undefined, `${language.label} (.${language.extension})`);
    option.value = language.id;
    option.selected = language.id === state.preferredLanguage;
    languageSelect.append(option);
  }

  const applyButton = actionButton({
    className: 'primary-button',
    label: ui.busy ? '적용 중…' : '적용',
    type: 'submit',
    disabled: ui.busy,
  });

  form.append(nicknameLabel, nicknameInput, languageLabel, languageSelect, applyButton);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      return;
    }
    post({
      type: 'saveSettings',
      nickname: nicknameInput.value,
      preferredLanguage: languageSelect.value,
    });
  });
  return form;
}
