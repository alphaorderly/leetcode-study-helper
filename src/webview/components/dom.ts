/** 태그에 맞는 요소를 만들고 클래스와 textContent를 설정합니다. */
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** 상태 역할과 장식용 스피너, 제목·설명을 갖춘 로딩 표시를 만듭니다. */
export function renderLoadingState(
  title: string,
  description?: string,
  className = '',
): HTMLElement {
  const loading = element('div', ['loading-state', className].filter(Boolean).join(' '));
  loading.setAttribute('role', 'status');

  const spinner = element('span', 'loading-spinner');
  spinner.setAttribute('aria-hidden', 'true');
  const copy = element('span', 'loading-copy');
  copy.append(element('strong', 'loading-title', title));
  if (description) {
    copy.append(element('span', 'loading-description', description));
  }
  loading.append(spinner, copy);
  return loading;
}
