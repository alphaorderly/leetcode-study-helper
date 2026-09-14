import type {
  ExtensionSnapshot,
  ProblemSnapshot,
  RepositorySnapshot,
  SolutionFileSnapshot,
} from '../../shared/contracts';
import { element } from '../components/dom';
import {
  bookOpenIcon,
  externalLinkIcon,
  gitStageIcon,
  setButtonTooltip,
  trashIcon,
  usersRoundIcon,
} from '../components/icons';
import {
  canToggleStage,
  creationHint,
  difficultyClass,
  difficultyLabel,
  formatProblemTitle,
  gitStatusLabel,
  gitStatusTitle,
  groupProblems,
  preferredSolution,
  solutionExtension,
  stageDisabledReason,
  visibleProblems,
} from '../state/problemViewModel';
import type { PostMessage, UiState } from '../state/viewTypes';

/** 스테이징 가능한 풀이에만 추가·해제 버튼을 만들고 작업 중·차단 상태를 반영합니다. */
function createStageButton(
  solution: SolutionFileSnapshot,
  problemTitle: string,
  ui: UiState,
  post: PostMessage,
  disabledReason?: string,
): HTMLButtonElement | undefined {
  if (!canToggleStage(solution.submissionStatus)) {
    return undefined;
  }
  const staged =
    solution.submissionStatus === 'staged' || solution.submissionStatus === 'staged-outdated';
  const needsRestage = solution.submissionStatus === 'staged-outdated';
  const button = element('button', `stage-button${staged ? ' active' : ''}`);
  button.type = 'button';
  button.disabled = ui.busy || Boolean(disabledReason);
  const action = needsRestage ? '최신 수정 다시 추가' : staged ? '커밋에서 빼기' : '커밋에 추가';
  button.setAttribute('aria-label', `${problemTitle} ${solution.name} ${action}`);
  setButtonTooltip(button, disabledReason ?? action);
  button.append(gitStageIcon(staged));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    post({
      type: staged && !needsRestage ? 'unstageSolution' : 'stageSolution',
      uri: solution.uri,
    });
  });
  return button;
}

/** 코드 풀이가 여러 개일 때만 선호 언어 우선의 파일 선택 영역을 만듭니다. */
function renderSolutionSection(
  problem: ProblemSnapshot,
  preferred: ProblemSnapshot['solutions'][number] | undefined,
  problemTitle: string,
  repository: RepositorySnapshot,
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): HTMLElement | undefined {
  const codeSolutions = problem.solutions
    .filter(({ name }) => !name.endsWith('.md'))
    .sort((left, right) => {
      if (left.uri === preferred?.uri) {
        return -1;
      }
      if (right.uri === preferred?.uri) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });
  if (codeSolutions.length < 2) {
    return undefined;
  }

  const section = element('div', 'solution-file-section');
  section.addEventListener('click', (event) => event.stopPropagation());
  section.append(element('span', 'solution-file-label', '다른 언어 풀이'));

  const buttons = element('div', 'solution-file-buttons');
  buttons.setAttribute('role', 'group');
  buttons.setAttribute('aria-label', `${problemTitle} 풀이 파일`);
  for (const codeSolution of codeSolutions) {
    const isPreferred = codeSolution.uri === preferred?.uri;
    const button = element(
      'button',
      `solution-button${isPreferred ? ' preferred' : ''}`,
      solutionExtension(codeSolution.name),
    );
    button.type = 'button';
    button.title = `${codeSolution.name} 열기`;
    button.setAttribute('aria-label', `${codeSolution.name} 풀이 파일 열기`);
    if (isPreferred) {
      button.setAttribute('aria-current', 'true');
    }
    button.disabled = ui.busy;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      post({ type: 'openSolution', uri: codeSolution.uri });
    });
    const item = element('span', 'solution-file-item');
    item.append(button);
    const stageButton =
      repository.submission?.fork.status === 'verified'
        ? createStageButton(
            codeSolution,
            problemTitle,
            ui,
            post,
            stageDisabledReason(repository, problem.week, state, codeSolution),
          )
        : undefined;
    if (stageButton) {
      stageButton.classList.add('solution-file-stage-button');
      item.append(stageButton);
    }
    buttons.append(item);
  }
  section.append(buttons);
  return section;
}

/** 문제 정보, 풀이 열기·생성·삭제와 제출 작업을 연결한 문제 카드를 만듭니다. */
function renderProblem(
  problem: ProblemSnapshot,
  repository: RepositorySnapshot,
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): HTMLElement {
  const card = element('article', `problem-card ${problem.completed ? 'completed' : 'incomplete'}`);
  const problemTitle = formatProblemTitle(problem.slug);
  const solution = problem.completed ? preferredSolution(problem, state) : undefined;
  const cardAction = element('button', 'problem-card-action');
  cardAction.type = 'button';
  if (solution) {
    cardAction.setAttribute('aria-label', `${problemTitle} 풀이 파일 열기`);
    cardAction.disabled = ui.busy;
    cardAction.addEventListener('click', () => post({ type: 'openSolution', uri: solution.uri }));
  } else if (!problem.completed) {
    cardAction.setAttribute('aria-label', `${problemTitle} 풀이 파일 만들기`);
    cardAction.disabled = ui.busy || !state.workspaceTrusted || !state.nickname;
    if (!state.workspaceTrusted) {
      cardAction.title = '파일을 만들려면 워크스페이스를 신뢰해야 합니다.';
    }
    cardAction.addEventListener('click', () =>
      post({ type: 'createSolution', rootUri: repository.rootUri, slug: problem.slug }),
    );
  } else {
    cardAction.disabled = true;
  }

  const heading = element('div', 'problem-heading');
  const title = element('h4', 'problem-title', problemTitle);
  const badges = element('div', 'problem-badges');
  const difficulty = element(
    'span',
    `difficulty ${difficultyClass(problem.difficulty)}`,
    difficultyLabel(problem.difficulty),
  );
  badges.append(difficulty);
  heading.append(title, badges);
  card.append(heading);

  const actions = element('div', 'solution-actions');
  const actionButtons = element('div', 'solution-action-buttons');
  const otherSolutionButton = element('button', 'other-solution-button');
  otherSolutionButton.type = 'button';
  otherSolutionButton.setAttribute('aria-label', `${problemTitle} 다른 참여자의 풀이 열기`);
  otherSolutionButton.disabled = ui.busy || !state.nickname || !problem.hasOtherSolutions;
  if (!state.nickname) {
    setButtonTooltip(otherSolutionButton, '닉네임 설정 후 사용할 수 있습니다.');
  } else if (!problem.hasOtherSolutions) {
    setButtonTooltip(otherSolutionButton, '다른 참여자의 풀이가 없습니다.');
  } else {
    setButtonTooltip(otherSolutionButton, '다른 참여자의 풀이 열기');
  }
  otherSolutionButton.append(usersRoundIcon());
  otherSolutionButton.addEventListener('click', (event) => {
    event.stopPropagation();
    post({
      type: 'openOtherSolution',
      rootUri: repository.rootUri,
      slug: problem.slug,
    });
  });
  actionButtons.append(otherSolutionButton);
  if (solution) {
    const status = element('span', 'solution-status has-file');
    status.title = gitStatusTitle(solution, repository);
    const gitStatus = element(
      'span',
      `solution-git-status ${solution.submissionStatus ?? solution.gitStatus}`,
      gitStatusLabel(solution, repository),
    );
    status.append(element('span', 'file-icon'), gitStatus);
    const deleteButton = element('button', 'delete-button');
    deleteButton.type = 'button';
    deleteButton.setAttribute('aria-label', `${solution.name} 풀이 파일 삭제`);
    setButtonTooltip(deleteButton, `${solution.name} 삭제`);
    deleteButton.disabled = ui.busy || !state.workspaceTrusted;
    if (!state.workspaceTrusted) {
      setButtonTooltip(
        deleteButton,
        `${solution.name} 파일을 삭제하려면 워크스페이스를 신뢰해야 합니다.`,
      );
    }
    deleteButton.append(trashIcon());
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      post({ type: 'deleteSolution', uri: solution.uri });
    });
    actionButtons.append(deleteButton);
    const stageButton =
      repository.submission?.fork.status === 'verified'
        ? createStageButton(
            solution,
            problemTitle,
            ui,
            post,
            stageDisabledReason(repository, problem.week, state, solution),
          )
        : undefined;
    if (stageButton) {
      actionButtons.append(stageButton);
    }
    actions.append(status);
  } else {
    const status = element('span', 'solution-status no-file');
    const statusCopy = element('span', 'solution-status-copy');
    statusCopy.append(
      element('span', 'solution-file-name', '풀이 없음'),
      element('span', 'solution-create-hint', creationHint(state)),
    );
    status.append(statusCopy);
    actions.append(status);
  }
  const answerButton = element('button', 'answer-button');
  answerButton.type = 'button';
  answerButton.setAttribute('aria-label', `${problemTitle} 정답 페이지 열기`);
  answerButton.disabled = ui.busy || !problem.solutionUrl;
  setButtonTooltip(
    answerButton,
    problem.solutionUrl ? '정답 페이지 열기' : 'README.md에서 정답 URL을 찾을 수 없습니다.',
  );
  answerButton.append(bookOpenIcon());
  answerButton.addEventListener('click', (event) => {
    event.stopPropagation();
    post({
      type: 'openAnswer',
      rootUri: repository.rootUri,
      slug: problem.slug,
    });
  });
  actionButtons.append(answerButton);
  const openPageButton = element('button', 'open-page-button');
  openPageButton.type = 'button';
  setButtonTooltip(openPageButton, 'LeetCode 페이지 열기');
  openPageButton.setAttribute('aria-label', `${problemTitle} LeetCode 페이지 열기`);
  openPageButton.disabled = ui.busy;
  openPageButton.append(externalLinkIcon());
  openPageButton.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'openProblem', slug: problem.slug });
  });
  actionButtons.append(openPageButton);
  actions.append(actionButtons);
  card.prepend(cardAction);
  card.append(actions);
  const solutionSection = renderSolutionSection(
    problem,
    solution,
    problemTitle,
    repository,
    state,
    ui,
    post,
  );
  if (solutionSection) {
    card.append(solutionSection);
  }
  return card;
}

/** 저장소의 문제를 현재 검색·필터·그룹 조건에 맞는 목록으로 렌더링합니다. */
function renderRepository(
  repository: RepositorySnapshot,
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
  showTitle: boolean,
): HTMLElement | undefined {
  const problems = visibleProblems(repository, state, ui);
  if (problems.length === 0) {
    return undefined;
  }

  const section = element('section', 'repository');
  if (showTitle) {
    section.append(element('h2', 'repository-title', repository.name));
  }

  const groups = groupProblems(problems, ui.groupBy);
  for (const { label, problems: groupProblems, kind } of groups) {
    const groupKind = ui.groupBy === 'week' ? 'week' : `difficulty-${kind ?? 'unknown'}`;
    const group = element('section', `problem-group ${groupKind}`);
    const groupHeader = element('div', 'group-header');
    groupHeader.append(
      element('h3', 'group-title', label),
      element('span', 'group-count', String(groupProblems.length)),
    );
    group.append(groupHeader);
    for (const problem of groupProblems) {
      group.append(renderProblem(problem, repository, state, ui, post));
    }
    section.append(group);
  }
  return section;
}

/** 저장소별 문제 영역을 만들고 표시할 문제가 없으면 안내를 반환합니다. */
export function renderProblemList(
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): HTMLElement[] {
  const repositories: HTMLElement[] = [];
  const showRepositoryTitle = state.repositories.length > 1;
  for (const repository of state.repositories) {
    const rendered = renderRepository(repository, state, ui, post, showRepositoryTitle);
    if (rendered) {
      repositories.push(rendered);
    }
  }
  if (repositories.length === 0) {
    repositories.push(element('p', 'empty-state', '현재 조건에 맞는 문제가 없습니다.'));
  }
  return repositories;
}
