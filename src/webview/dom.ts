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

export function renderLoadingState(
  title: string,
  description?: string,
  className = '',
): HTMLElement {
  const loading = element(
    'div',
    ['loading-state', className].filter(Boolean).join(' '),
  );
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
