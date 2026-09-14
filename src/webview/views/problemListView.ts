import type { ProblemSnapshot, RepositorySnapshot } from '../../shared/contracts';
import { actionButton } from '../components/controls';
import { element } from '../components/dom';
import {
  bookOpenIcon,
  externalLinkIcon,
  gitStageIcon,
  trashIcon,
  usersRoundIcon,
} from '../components/icons';
import {
  problemCardModel,
  type IconAction,
  type ProblemCardModel,
  type StageAction,
} from '../state/problemCardModel';
import { groupProblems, visibleProblems } from '../state/problemViewModel';
import type { ViewContext } from '../state/viewTypes';

/** 스테이징 가능한 풀이에만 추가·해제 버튼을 만들고 작업 중·차단 상태를 반영합니다. */
function createStageButton(stage: StageAction, post: ViewContext['post']): HTMLButtonElement {
  const button = actionButton({
    className: `stage-button${stage.staged ? ' active' : ''}`,
    disabled: stage.disabled,
    ariaLabel: stage.ariaLabel,
    tooltip: stage.tooltip,
    stopPropagation: true,
    onClick: () =>
      post({
        type: stage.staged && !stage.needsRestage ? 'unstageSolution' : 'stageSolution',
        uri: stage.uri,
      }),
  });
  button.append(gitStageIcon(stage.staged));
  return button;
}

/** 코드 풀이가 여러 개일 때만 선호 언어 우선의 파일 선택 영역을 만듭니다. */
function renderSolutionSection(
  model: ProblemCardModel,
  post: ViewContext['post'],
): HTMLElement | undefined {
  const extraSolutions = model.extraSolutions;
  if (!extraSolutions) {
    return undefined;
  }

  const section = element('div', 'solution-file-section');
  section.addEventListener('click', (event) => event.stopPropagation());
  section.append(element('span', 'solution-file-label', '다른 언어 풀이'));

  const buttons = element('div', 'solution-file-buttons');
  buttons.setAttribute('role', 'group');
  buttons.setAttribute('aria-label', `${model.title} 풀이 파일`);
  for (const file of extraSolutions) {
    const button = actionButton({
      className: `solution-button${file.preferred ? ' preferred' : ''}`,
      label: file.extension,
      title: `${file.name} 열기`,
      ariaLabel: `${file.name} 풀이 파일 열기`,
      ariaCurrent: file.preferred ? 'true' : undefined,
      disabled: file.disabled,
      stopPropagation: true,
      onClick: () => post({ type: 'openSolution', uri: file.uri }),
    });
    const item = element('span', 'solution-file-item');
    item.append(button);
    if (file.stage) {
      const stageButton = createStageButton(file.stage, post);
      stageButton.classList.add('solution-file-stage-button');
      item.append(stageButton);
    }
    buttons.append(item);
  }
  section.append(buttons);
  return section;
}

/** 아이콘과 툴팁을 가진 카드 동작 버튼을 만듭니다. */
function iconActionButton(
  action: IconAction,
  icon: SVGSVGElement,
  post: ViewContext['post'],
): HTMLButtonElement {
  const button = actionButton({
    className: action.className,
    ariaLabel: action.ariaLabel,
    tooltip: action.tooltip,
    disabled: action.disabled,
    stopPropagation: true,
    onClick: () => post(action.message),
  });
  button.append(icon);
  return button;
}

/**
 * ProblemCardModel이 계산한 제목·대표 동작·보조 버튼을 DOM으로 옮깁니다.
 * 파일 생성·삭제·스테이징은 메시지로 요청하며 카드 내부 버튼은 본문 동작과의 이벤트 전파를 구분합니다.
 * 정책 변경은 뷰에 조건을 추가하기 전에 해당 모델과 stagePolicy에서 검토합니다.
 */
function renderProblem(
  problem: ProblemSnapshot,
  repository: RepositorySnapshot,
  context: ViewContext,
): HTMLElement {
  const { post } = context;
  const model = problemCardModel(problem, repository, context);
  const card = element('article', `problem-card ${model.completed ? 'completed' : 'incomplete'}`);
  const cardAction = actionButton({
    className: 'problem-card-action',
    ariaLabel: model.primary.kind === 'none' ? undefined : model.primary.ariaLabel,
    disabled: model.primary.disabled,
    title: model.primary.kind === 'create' ? model.primary.title : undefined,
    onClick: () => {
      if (model.primary.kind === 'open') {
        post({ type: 'openSolution', uri: model.primary.uri });
      } else if (model.primary.kind === 'create') {
        post({
          type: 'createSolution',
          rootUri: model.primary.rootUri,
          slug: model.primary.slug,
        });
      }
    },
  });

  const heading = element('div', 'problem-heading');
  const badges = element('div', 'problem-badges');
  badges.append(element('span', `difficulty ${model.difficultyClassName}`, model.difficultyText));
  heading.append(element('h4', 'problem-title', model.title), badges);
  card.append(heading);

  const actions = element('div', 'solution-actions');
  const actionButtons = element('div', 'solution-action-buttons');
  actionButtons.append(iconActionButton(model.otherSolutions, usersRoundIcon(), post));
  if (model.status.kind === 'has-file') {
    const status = element('span', 'solution-status has-file');
    status.title = model.status.title;
    const gitStatus = element(
      'span',
      `solution-git-status ${model.status.gitClass}`,
      model.status.gitLabel,
    );
    status.append(element('span', 'file-icon'), gitStatus);
    if (model.delete) {
      actionButtons.append(iconActionButton(model.delete, trashIcon(), post));
    }
    if (model.stage) {
      actionButtons.append(createStageButton(model.stage, post));
    }
    actions.append(status);
  } else {
    const status = element('span', 'solution-status no-file');
    const statusCopy = element('span', 'solution-status-copy');
    statusCopy.append(
      element('span', 'solution-file-name', '풀이 없음'),
      element('span', 'solution-create-hint', model.status.hint),
    );
    status.append(statusCopy);
    actions.append(status);
  }
  actionButtons.append(
    iconActionButton(model.answer, bookOpenIcon(), post),
    iconActionButton(model.openPage, externalLinkIcon(), post),
  );
  actions.append(actionButtons);
  card.prepend(cardAction);
  card.append(actions);
  const solutionSection = renderSolutionSection(model, post);
  if (solutionSection) {
    card.append(solutionSection);
  }
  return card;
}

/** 저장소의 문제를 현재 검색·필터·그룹 조건에 맞는 목록으로 렌더링합니다. */
function renderRepository(
  repository: RepositorySnapshot,
  context: ViewContext,
  showTitle: boolean,
): HTMLElement | undefined {
  const { state, ui } = context;
  const problems = visibleProblems(repository, state, ui);
  if (problems.length === 0) {
    return undefined;
  }

  const section = element('section', 'repository');
  if (showTitle) {
    section.append(element('h2', 'repository-title', repository.name));
  }

  const groups = groupProblems(problems, ui.groupBy);
  for (const { label, problems: grouped, kind } of groups) {
    const groupKind = ui.groupBy === 'week' ? 'week' : `difficulty-${kind ?? 'unknown'}`;
    const group = element('section', `problem-group ${groupKind}`);
    const groupHeader = element('div', 'group-header');
    groupHeader.append(
      element('h3', 'group-title', label),
      element('span', 'group-count', String(grouped.length)),
    );
    group.append(groupHeader);
    for (const problem of grouped) {
      group.append(renderProblem(problem, repository, context));
    }
    section.append(group);
  }
  return section;
}

/** 저장소별 문제 영역을 만들고 표시할 문제가 없으면 안내를 반환합니다. */
export function renderProblemList(context: ViewContext): HTMLElement[] {
  const repositories: HTMLElement[] = [];
  const showRepositoryTitle = context.state.repositories.length > 1;
  for (const repository of context.state.repositories) {
    const rendered = renderRepository(repository, context, showRepositoryTitle);
    if (rendered) {
      repositories.push(rendered);
    }
  }
  if (repositories.length === 0) {
    repositories.push(element('p', 'empty-state', '현재 조건에 맞는 문제가 없습니다.'));
  }
  return repositories;
}
