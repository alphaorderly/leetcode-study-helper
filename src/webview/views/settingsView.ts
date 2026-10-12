import type { TelemetrySettingsSnapshot } from '../../shared/contracts';
import { actionButton } from '../components/controls';
import { element } from '../components/dom';
import type { ViewContext } from '../state/viewTypes';

/**
 * 호스트 스냅샷으로 설정 폼을 초기화하고 제출 시 saveSettings 메시지를 보냅니다.
 * 닉네임이 없으면 항상 펼치고, 설정된 뒤에는 현재 값을 요약한 접힌 패널로 보여 줍니다.
 * 펼침 여부는 ui.settingsOpen에 보관해 상태 갱신으로 다시 그려도 유지하며 적용 후에는 접습니다.
 * 실제 설정 검증·저장·저장소 재탐색은 호스트가 담당하며, ui.busy는 입력·버튼의 진행 표시용입니다.
 */
export function renderSettings({ state, ui, post }: ViewContext): HTMLElement {
  const panel = element('details', 'settings-panel');
  const language = state.languages.find(({ id }) => id === state.preferredLanguage);
  panel.append(
    element(
      'summary',
      'settings-summary',
      state.nickname
        ? `설정 · ${state.nickname} · ${language?.label ?? state.preferredLanguage}`
        : '설정',
    ),
  );
  panel.open = !state.nickname || Boolean(ui.settingsOpen);
  panel.addEventListener('toggle', () => {
    ui.settingsOpen = panel.open;
  });

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
    ui.settingsOpen = false;
    post({
      type: 'saveSettings',
      nickname: nicknameInput.value,
      preferredLanguage: languageSelect.value,
    });
  });
  panel.append(form, renderTelemetrySettings({ state, ui, post }));
  return panel;
}

/** 사용 통계 상태를 동의 여부와 실제 수집 가능 여부로 구분해 설명합니다. */
function telemetryStatus(state: TelemetrySettingsSnapshot | undefined): string {
  if (!state?.enabled) {
    return '사용 통계를 수집하지 않습니다.';
  }
  if (state.effectiveEnabled) {
    return '사용 통계 수집을 허용했습니다. 설정에서 언제든 끌 수 있습니다.';
  }
  switch (state.disabledReason) {
    case 'vscode':
      return 'VS Code 사용 통계 설정이 꺼져 있어 수집하지 않습니다.';
    case 'development':
      return '개발·테스트 실행에서는 사용 통계를 수집하지 않습니다.';
    case 'storage':
      return '설치 식별자를 저장하지 못해 이번 실행에서는 수집하지 않습니다.';
    default:
      return '현재 실행에서는 사용 통계를 수집하지 않습니다.';
  }
}

/** 닉네임 검증·적용 버튼과 독립적인 사용 통계 동의 영역을 만듭니다. */
function renderTelemetrySettings({ state, post }: ViewContext): HTMLElement {
  const section = element('section', 'settings-card telemetry-settings');
  section.setAttribute('aria-label', '사용 통계 설정');
  const label = element('label', 'telemetry-label');
  label.htmlFor = 'telemetry-enabled';
  const checkbox = element('input', 'telemetry-checkbox');
  checkbox.type = 'checkbox';
  checkbox.id = 'telemetry-enabled';
  checkbox.checked = state.telemetry?.enabled ?? false;
  checkbox.setAttribute('aria-describedby', 'telemetry-description telemetry-status');
  checkbox.addEventListener('change', () => {
    post({ type: 'setTelemetryEnabled', enabled: checkbox.checked });
  });
  label.append(checkbox, element('span', undefined, '사용 통계 수집 허용'));
  const description = element(
    'p',
    'telemetry-description',
    '기능 개선을 위해 무작위 설치 식별자, 기능·문제·주차·언어와 실행 결과를 PostHog US에 보냅니다. 닉네임, 코드, 파일 경로와 저장소 주소는 보내지 않습니다.',
  );
  description.id = 'telemetry-description';
  const status = element('p', 'telemetry-status', telemetryStatus(state.telemetry));
  status.id = 'telemetry-status';
  status.setAttribute('role', 'status');
  section.append(label, description, status);
  return section;
}

/** 사용 통계 부분 응답으로 체크박스와 설명만 갱신해 작성 중인 폼과 화면을 보존합니다. */
export function updateTelemetrySettings(root: HTMLElement, state: TelemetrySettingsSnapshot): void {
  const checkbox = root.querySelector<HTMLInputElement>('#telemetry-enabled');
  if (checkbox) {
    checkbox.checked = state.enabled;
  }
  const status = root.querySelector<HTMLElement>('#telemetry-status');
  if (status) {
    status.textContent = telemetryStatus(state);
  }
}
