import type {
  ProblemSnapshot,
  RepositorySnapshot,
  SolutionFileSnapshot,
  WebviewToExtensionMessage,
} from '../../shared/contracts';
import {
  difficultyClass,
  difficultyLabel,
  formatProblemTitle,
  preferredSolution,
} from './problemViewModel';
import { gitStatusLabel, gitStatusTitle } from './solutionStatus';
import { canToggleStage, stageDisabledReason } from './stagePolicy';
import type { ViewContext } from './viewTypes';

/** 카드 본문 클릭이 열기·생성·없음 중 어떤 동작인지 나타냅니다. */
export type PrimaryCardAction =
  | { kind: 'open'; ariaLabel: string; disabled: boolean; uri: string }
  | {
      kind: 'create';
      ariaLabel: string;
      disabled: boolean;
      title?: string;
      rootUri: string;
      slug: string;
    }
  | { kind: 'none'; disabled: true };

/** 아이콘 버튼의 클래스·툴팁과 전송 메시지입니다. */
export interface IconAction {
  className: string;
  ariaLabel: string;
  tooltip: string;
  disabled: boolean;
  message: WebviewToExtensionMessage;
}

/** 커밋 추가·해제 버튼의 표시와 전송 대상 URI입니다. */
export interface StageAction {
  staged: boolean;
  needsRestage: boolean;
  disabled: boolean;
  ariaLabel: string;
  tooltip: string;
  uri: string;
}

/** 여러 언어 풀이 중 하나에 대한 열기·스테이징 표시입니다. */
export interface ExtraSolutionFile {
  extension: string;
  name: string;
  uri: string;
  preferred: boolean;
  disabled: boolean;
  stage?: StageAction;
}

/** 문제 카드 렌더가 읽는 제목·상태·버튼 모델입니다. */
export interface ProblemCardModel {
  title: string;
  completed: boolean;
  difficultyClassName: string;
  difficultyText: string;
  primary: PrimaryCardAction;
  status:
    | { kind: 'has-file'; title: string; gitClass: string; gitLabel: string }
    | { kind: 'no-file'; hint: string };
  otherSolutions: IconAction;
  delete?: IconAction;
  stage?: StageAction;
  answer: IconAction;
  openPage: IconAction;
  extraSolutions?: ExtraSolutionFile[];
}

/** 닉네임과 워크스페이스 신뢰 상태에 따라 풀이 생성 안내를 반환합니다. */
export function creationHint(state: ViewContext['state']): string {
  if (!state.nickname) {
    return '닉네임 설정 후 생성';
  }
  if (!state.workspaceTrusted) {
    return '워크스페이스 신뢰 후 생성';
  }
  return '카드를 눌러 생성';
}

/** 풀이 파일명에서 언어 표시용 확장자를 추출합니다. */
export function solutionExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot === -1 ? fileName : fileName.slice(lastDot);
}

/**
 * 문제 카드의 표시와 사용자 명령을 순수하게 계산합니다. DOM 생성이나 실제 파일·Git 작업은 하지 않습니다.
 * 대표 풀이는 선호 언어를 우선하고, stage·delete·추가 풀이 목록은 해당 조건이 없으면 생략합니다.
 * 여기서 버튼이 활성화되어도 호스트가 명령 실행 시 현재 상태를 다시 검증합니다.
 */
export function problemCardModel(
  problem: ProblemSnapshot,
  repository: RepositorySnapshot,
  { state, ui }: ViewContext,
): ProblemCardModel {
  const title = formatProblemTitle(problem.slug);
  const solution = problem.completed ? preferredSolution(problem, state) : undefined;
  const showStage = repository.submission?.fork.status === 'verified';
  return {
    title,
    completed: problem.completed,
    difficultyClassName: difficultyClass(problem.difficulty),
    difficultyText: difficultyLabel(problem.difficulty),
    primary: primaryAction(problem, repository, solution, title, state, ui.busy),
    status: solution
      ? {
          kind: 'has-file',
          title: gitStatusTitle(solution, repository),
          gitClass: solution.submissionStatus ?? solution.gitStatus,
          gitLabel: gitStatusLabel(solution, repository),
        }
      : { kind: 'no-file', hint: creationHint(state) },
    otherSolutions: {
      className: 'other-solution-button',
      ariaLabel: `${title} 다른 참여자의 풀이 열기`,
      disabled: ui.busy || !state.nickname || !problem.hasOtherSolutions,
      tooltip: !state.nickname
        ? '닉네임 설정 후 사용할 수 있습니다.'
        : !problem.hasOtherSolutions
          ? '다른 참여자의 풀이가 없습니다.'
          : '다른 참여자의 풀이 열기',
      message: {
        type: 'openOtherSolution',
        rootUri: repository.rootUri,
        slug: problem.slug,
      },
    },
    delete: solution
      ? {
          className: 'delete-button',
          ariaLabel: `${solution.name} 풀이 파일 삭제`,
          disabled: ui.busy || !state.workspaceTrusted,
          tooltip: state.workspaceTrusted
            ? `${solution.name} 삭제`
            : `${solution.name} 파일을 삭제하려면 워크스페이스를 신뢰해야 합니다.`,
          message: { type: 'deleteSolution', uri: solution.uri },
        }
      : undefined,
    stage:
      showStage && solution
        ? stageAction(solution, title, repository, problem.week, state, ui.busy)
        : undefined,
    answer: {
      className: 'answer-button',
      ariaLabel: `${title} 정답 페이지 열기`,
      disabled: ui.busy || !problem.solutionUrl,
      tooltip: problem.solutionUrl
        ? '정답 페이지 열기'
        : 'README.md에서 정답 URL을 찾을 수 없습니다.',
      message: { type: 'openAnswer', rootUri: repository.rootUri, slug: problem.slug },
    },
    openPage: {
      className: 'open-page-button',
      ariaLabel: `${title} LeetCode 페이지 열기`,
      disabled: ui.busy,
      tooltip: 'LeetCode 페이지 열기',
      message: { type: 'openProblem', slug: problem.slug },
    },
    extraSolutions: extraSolutionFiles(
      problem,
      solution,
      repository,
      state,
      ui.busy,
      showStage,
      title,
    ),
  };
}

/** 카드 본문 클릭이 풀이 열기인지 생성인지 결정합니다. */
function primaryAction(
  problem: ProblemSnapshot,
  repository: RepositorySnapshot,
  solution: SolutionFileSnapshot | undefined,
  title: string,
  state: ViewContext['state'],
  busy: boolean,
): PrimaryCardAction {
  if (solution) {
    return {
      kind: 'open',
      ariaLabel: `${title} 풀이 파일 열기`,
      disabled: busy,
      uri: solution.uri,
    };
  }
  if (!problem.completed) {
    return {
      kind: 'create',
      ariaLabel: `${title} 풀이 파일 만들기`,
      disabled: busy || !state.workspaceTrusted || !state.nickname,
      title: state.workspaceTrusted ? undefined : '파일을 만들려면 워크스페이스를 신뢰해야 합니다.',
      rootUri: repository.rootUri,
      slug: problem.slug,
    };
  }
  return { kind: 'none', disabled: true };
}

/** 스테이징 가능한 풀이만 추가·해제 버튼 모델로 만듭니다. */
export function stageAction(
  solution: SolutionFileSnapshot,
  problemTitle: string,
  repository: RepositorySnapshot,
  week: number | undefined,
  state: ViewContext['state'],
  busy: boolean,
): StageAction | undefined {
  if (!canToggleStage(solution.submissionStatus)) {
    return undefined;
  }
  const staged =
    solution.submissionStatus === 'staged' || solution.submissionStatus === 'staged-outdated';
  const needsRestage = solution.submissionStatus === 'staged-outdated';
  const action = needsRestage ? '최신 수정 다시 추가' : staged ? '커밋에서 빼기' : '커밋에 추가';
  const disabledReason = stageDisabledReason(repository, week, state, solution);
  return {
    staged,
    needsRestage,
    disabled: busy || Boolean(disabledReason),
    ariaLabel: `${problemTitle} ${solution.name} ${action}`,
    tooltip: disabledReason ?? action,
    uri: solution.uri,
  };
}

/** 코드 풀이가 두 개 이상일 때만 선호 언어 우선의 파일 목록을 만듭니다. */
function extraSolutionFiles(
  problem: ProblemSnapshot,
  preferred: SolutionFileSnapshot | undefined,
  repository: RepositorySnapshot,
  state: ViewContext['state'],
  busy: boolean,
  showStage: boolean,
  title: string,
): ExtraSolutionFile[] | undefined {
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
  return codeSolutions.map((codeSolution) => ({
    extension: solutionExtension(codeSolution.name),
    name: codeSolution.name,
    uri: codeSolution.uri,
    preferred: codeSolution.uri === preferred?.uri,
    disabled: busy,
    stage: showStage
      ? stageAction(codeSolution, title, repository, problem.week, state, busy)
      : undefined,
  }));
}
