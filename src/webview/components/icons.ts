/** 공통 stroke 속성과 장식용 접근성 표시를 갖춘 SVG 아이콘 루트를 만듭니다. */
function svgIcon(className: string): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add(className);
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  return icon;
}

/** 외부 페이지 열기 버튼에 사용할 장식용 SVG 아이콘을 생성합니다. */
export function externalLinkIcon(): SVGSVGElement {
  const icon = svgIcon('external-link-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M14 3h7v7M21 3 10 14M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  );
  icon.append(path);
  return icon;
}

/** 풀이 삭제 버튼에 사용할 장식용 SVG 아이콘을 생성합니다. */
export function trashIcon(): SVGSVGElement {
  const icon = svgIcon('trash-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5');
  icon.append(path);
  return icon;
}

/** 다른 참여자 풀이 버튼에 사용할 장식용 SVG 아이콘을 생성합니다. */
export function usersRoundIcon(): SVGSVGElement {
  const icon = svgIcon('users-round-icon');
  const primaryUser = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  primaryUser.setAttribute('cx', '10');
  primaryUser.setAttribute('cy', '8');
  primaryUser.setAttribute('r', '4');

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  group.setAttribute('d', 'M2 21a8 8 0 0 1 16 0M17 3.13a4 4 0 0 1 0 7.75M22 21a8 8 0 0 0-5-7.44');
  icon.append(primaryUser, group);
  return icon;
}

/** 문제 설명 열기 버튼에 사용할 장식용 SVG 아이콘을 생성합니다. */
export function bookOpenIcon(): SVGSVGElement {
  const icon = svgIcon('book-open-icon');
  const center = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  center.setAttribute('d', 'M12 7v14');
  const leftPage = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  leftPage.setAttribute(
    'd',
    'M3 18a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h5a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3Z',
  );
  const rightPage = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  rightPage.setAttribute(
    'd',
    'M21 18a1 1 0 0 0 1-1V5a2 2 0 0 0-2-2h-5a3 3 0 0 0-3 3v15a3 3 0 0 1 3-3Z',
  );
  icon.append(center, leftPage, rightPage);
  return icon;
}

/** 스테이징 여부에 맞는 Git 작업 버튼용 SVG 아이콘을 생성합니다. */
export function gitStageIcon(active: boolean): SVGSVGElement {
  const icon = svgIcon('git-stage-icon');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '3');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    active ? 'M12 2v7M12 15v7M2 12h7M15 12h7' : 'M12 2v7M12 15v7M5 12h4M15 12h4M19 9v6M16 12h6',
  );
  icon.append(circle, path);
  return icon;
}

/** CSS 툴팁이 읽을 버튼의 data-tooltip 속성을 설정합니다. */
export function setButtonTooltip(button: HTMLButtonElement, text: string): void {
  button.dataset.tooltip = text;
}
