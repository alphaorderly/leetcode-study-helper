import type {
  ExtensionSnapshot,
  ProblemSnapshot,
  RepositorySnapshot,
  SolutionFileSnapshot,
  SolutionSubmissionStatus,
} from '../core/types';
import { element } from './dom';
import {
  bookOpenIcon,
  externalLinkIcon,
  gitStageIcon,
  setButtonTooltip,
  trashIcon,
  usersRoundIcon,
} from './icons';
import {
  difficultyClass,
  difficultyLabel,
  formatProblemTitle,
  groupProblems,
  preferredSolution,
  visibleProblems,
} from './problemViewModel';
import type { PostMessage, UiState } from './viewTypes';

function gitStatusLabel(
  solution: ProblemSnapshot['solutions'][number],
  repository: RepositorySnapshot,
): string {
  if (solution.submissionStatus && solution.submissionStatus !== 'unknown') {
    return submissionStatusLabel(solution);
  }
  const remote = repository.gitRemote ?? '원격';
  switch (solution.gitStatus) {
    case 'checking':
      return '푸시 상태 확인 중';
    case 'pushed':
      return `${remote}`;
    case 'unpushed':
      return `push 되지 않음`;
    case 'unknown':
      return '푸시 상태 확인 불가';
  }
}

function submissionStatusLabel(solution: SolutionFileSnapshot): string {
  switch (solution.submissionStatus) {
    case 'checking':
      return '제출 상태 확인 중';
    case 'working':
      return '작성 중';
    case 'staged':
      return '커밋 준비';
    case 'staged-outdated':
      return '추가 수정 있음';
    case 'push-needed':
      return 'push 필요';
    case 'pr-needed':
      return 'PR 필요';
    case 'pr-open':
      return solution.pullRequestNumber
        ? `PR #${solution.pullRequestNumber} 진행 중`
        : 'PR 진행 중';
    case 'merged':
      return '병합 완료';
    case 'sync-needed':
      return '동기화 후 확인';
    case 'conflict':
      return '충돌 확인 필요';
    case 'unknown':
    case undefined:
      return '상태 확인 불가';
  }
}

function gitStatusTitle(
  solution: ProblemSnapshot['solutions'][number],
  repository: RepositorySnapshot,
): string {
  if (solution.submissionStatus && solution.submissionStatus !== 'unknown') {
    return `${solution.name}: ${submissionStatusLabel(solution)}`;
  }
  const remote = repository.gitRemote ?? '원격 저장소';
  switch (solution.gitStatus) {
    case 'checking':
      return `${solution.name}의 푸시 상태를 확인하고 있습니다.`;
    case 'pushed':
      return `${solution.name}의 로컬 변경이 모두 ${remote}에 반영되어 있습니다.`;
    case 'unpushed':
      return `${solution.name}에 ${remote}으로 보내지 않은 로컬 변경이 있습니다.`;
    case 'unknown':
      return 'Git 저장소 또는 현재 브랜치의 upstream을 확인할 수 없습니다.';
  }
}

function creationHint(state: ExtensionSnapshot): string {
  if (!state.nickname) {
    return '닉네임 설정 후 생성';
  }
  if (!state.workspaceTrusted) {
    return '워크스페이스 신뢰 후 생성';
  }
  return '카드를 눌러 생성';
}

function solutionExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot === -1 ? fileName : fileName.slice(lastDot);
}

function canToggleStage(status: SolutionSubmissionStatus | undefined): boolean {
  return status === 'working'
    || status === 'staged'
    || status === 'staged-outdated';
}

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
  const staged = solution.submissionStatus === 'staged'
    || solution.submissionStatus === 'staged-outdated';
  const needsRestage = solution.submissionStatus === 'staged-outdated';
  const button = element(
    'button',
    `stage-button${staged ? ' active' : ''}`,
  );
  button.type = 'button';
  button.disabled = ui.busy || Boolean(disabledReason);
  const action = needsRestage
    ? '최신 수정 다시 추가'
    : staged ? '커밋에서 빼기' : '커밋에 추가';
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

function stageDisabledReason(
  repository: RepositorySnapshot,
  week: number | undefined,
  state: ExtensionSnapshot,
  solution: SolutionFileSnapshot,
): string | undefined {
  if (!state.workspaceTrusted) {
    return '워크스페이스를 신뢰한 뒤 커밋에 추가할 수 있습니다.';
  }
  const submission = repository.submission;
  if (submission?.fork.status !== 'verified') {
    return submission?.fork.reason
      ?? 'DaleStudy 포크에서만 제출 기능을 사용할 수 있습니다.';
  }
  const staged = solution.submissionStatus === 'staged'
    || solution.submissionStatus === 'staged-outdated';
  if (staged) {
    return undefined;
  }
  if (submission.blockedReason) {
    return submission.blockedReason;
  }
  if (
    week !== undefined
    && submission.activeSubmissionWeek !== undefined
    && submission.activeSubmissionWeek !== week
  ) {
    return `Week ${submission.activeSubmissionWeek} 제출을 먼저 완료해 주세요.`;
  }
  return undefined;
}

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
    const stageButton = repository.submission?.fork.status === 'verified'
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
    cardAction.addEventListener('click', () =>
      post({ type: 'openSolution', uri: solution.uri }),
    );
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
  otherSolutionButton.setAttribute(
    'aria-label',
    `${problemTitle} 다른 참여자의 풀이 열기`,
  );
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
    status.append(
      element('span', 'file-icon'),
      gitStatus,
    );
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
    const stageButton = repository.submission?.fork.status === 'verified'
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
    problem.solutionUrl
      ? '정답 페이지 열기'
      : 'README.md에서 정답 URL을 찾을 수 없습니다.',
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
    const groupKind = ui.groupBy === 'week'
      ? 'week'
      : `difficulty-${kind ?? 'unknown'}`;
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

export function renderProblemList(
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): HTMLElement[] {
  const repositories: HTMLElement[] = [];
  const showRepositoryTitle = state.repositories.length > 1;
  for (const repository of state.repositories) {
    const rendered = renderRepository(
      repository,
      state,
      ui,
      post,
      showRepositoryTitle,
    );
    if (rendered) {
      repositories.push(rendered);
    }
  }
  if (repositories.length === 0) {
    repositories.push(
      element('p', 'empty-state', '현재 조건에 맞는 문제가 없습니다.'),
    );
  }
  return repositories;
}
