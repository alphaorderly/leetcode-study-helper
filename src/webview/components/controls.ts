import { element } from './dom';
import { setButtonTooltip } from './icons';

/** 공통 버튼의 표시·비활성·접근성 속성과 클릭 동작을 묶습니다. */
export interface ActionButtonOptions {
  className?: string;
  label?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  tooltip?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
  ariaSelected?: boolean;
  ariaCurrent?: string;
  role?: string;
  stopPropagation?: boolean;
  onClick?: (event: MouseEvent) => void;
}

/**
 * 버튼의 기본 type을 button으로 지정해 폼 내부에서 의도치 않은 submit을 막습니다.
 * disabled는 네이티브 속성으로 반영하고 stopPropagation은 카드 내부 버튼의 이벤트 전파를 막습니다.
 * DOM만 생성하며 호스트 명령 검증이나 비동기 작업 상태 관리는 호출자가 담당합니다.
 */
export function actionButton(options: ActionButtonOptions): HTMLButtonElement {
  const button = element('button', options.className, options.label);
  button.type = options.type ?? 'button';
  button.disabled = Boolean(options.disabled);
  if (options.title) {
    button.title = options.title;
  }
  if (options.tooltip) {
    setButtonTooltip(button, options.tooltip);
  }
  if (options.ariaLabel) {
    button.setAttribute('aria-label', options.ariaLabel);
  }
  if (options.ariaPressed !== undefined) {
    button.setAttribute('aria-pressed', String(options.ariaPressed));
  }
  if (options.ariaSelected !== undefined) {
    button.setAttribute('aria-selected', String(options.ariaSelected));
  }
  if (options.ariaCurrent) {
    button.setAttribute('aria-current', options.ariaCurrent);
  }
  if (options.role) {
    button.setAttribute('role', options.role);
  }
  if (options.onClick) {
    button.addEventListener('click', (event) => {
      if (options.stopPropagation) {
        event.stopPropagation();
      }
      options.onClick?.(event);
    });
  }
  return button;
}

/** 토글 그룹의 한 항목 값과 표시 문구, 비활성 상태를 나타냅니다. */
export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
  role?: string;
}

/** 선택 값에 맞춰 active 클래스를 갱신하는 버튼 그룹을 만듭니다. */
export function toggleGroup<T extends string>(options: {
  options: readonly ToggleOption<T>[];
  value: T;
  ariaLabel: string;
  groupClass: string;
  buttonClass: string;
  groupRole?: string;
  selectedAttribute?: 'aria-pressed' | 'aria-selected';
  onSelect: (value: T) => void;
}): HTMLElement {
  const selectedAttribute = options.selectedAttribute ?? 'aria-pressed';
  const group = element('div', options.groupClass);
  group.setAttribute('role', options.groupRole ?? 'group');
  group.setAttribute('aria-label', options.ariaLabel);
  for (const option of options.options) {
    const selected = option.value === options.value;
    const button = actionButton({
      className: `${options.buttonClass}${selected ? ' active' : ''}`,
      label: option.label,
      disabled: option.disabled,
      title: option.title,
      role: option.role,
      onClick: () => {
        for (const tab of group.querySelectorAll<HTMLButtonElement>(`.${options.buttonClass}`)) {
          const active = tab === button;
          tab.classList.toggle('active', active);
          tab.setAttribute(selectedAttribute, String(active));
        }
        options.onSelect(option.value);
      },
    });
    button.setAttribute(selectedAttribute, String(selected));
    group.append(button);
  }
  return group;
}

/** 저장소 상대 경로에서 파일 이름만 남깁니다. */
export function fileName(relativePath: string): string {
  return relativePath.split('/').pop() ?? relativePath;
}

/** 제출 파일의 저장소 상대 경로를 목록 요소로 표시합니다. */
export function renderFileList(files: readonly { relativePath: string }[]): HTMLElement {
  const list = element('ul', 'submission-file-list');
  for (const file of files) {
    const item = element('li', 'submission-file', file.relativePath);
    item.title = file.relativePath;
    list.append(item);
  }
  return list;
}

/** 풀이 외 파일 경로를 접을 수 있는 목록으로 표시합니다. */
export function pathDetails(
  summary: string,
  paths: readonly string[],
  options?: { open?: boolean },
): HTMLElement {
  const warning = element('details', 'submission-other-files');
  if (options?.open) {
    warning.open = true;
  }
  warning.append(
    element('summary', undefined, summary),
    renderFileList(paths.map((relativePath) => ({ relativePath }))),
  );
  return warning;
}
