import type { OnboardingAction } from '../../shared/contracts';
import { actionButton } from '../components/controls';
import { element } from '../components/dom';
import {
  type ForkNotice,
  type OnboardingModel,
  type OnboardingStep,
  type OnboardingStepStatus,
  type StudyOnboarding,
} from '../state/onboardingModel';
import { formatProblemTitle } from '../state/problemViewModel';
import type { ViewContext } from '../state/viewTypes';

const REMOTE_COMMAND =
  'git remote set-url origin https://github.com/<내 아이디>/leetcode-study.git';

const STATUS_MARKER: Record<OnboardingStepStatus, { symbol: string; label: string }> = {
  done: { symbol: '✓', label: '완료' },
  current: { symbol: '●', label: '지금 할 일' },
  todo: { symbol: '○', label: '대기' },
  checking: { symbol: '…', label: '확인 중' },
  warning: { symbol: '!', label: '확인 필요' },
};

const STEP_LABEL: Record<OnboardingStep['id'], string> = {
  repository: '스터디 저장소 열기',
  profile: '닉네임·기본 언어 설정',
  'first-solution': '첫 풀이 만들기',
  submission: '제출 준비',
};

/** 포크·Git 상태별 설명입니다. 목록과 테스트는 제출 준비와 무관하게 쓸 수 있음을 함께 알립니다. */
const FORK_DETAIL: Record<ForkNotice, string> = {
  checking: '내 포크인지 확인하고 있습니다.',
  verified: '내 포크가 확인되었습니다.',
  'no-git':
    'Git 저장소로 인식되지 않았습니다. 내 포크를 git clone으로 받은 폴더를 열어야 제출할 수 있습니다. Git이 설치되어 있지 않거나 git.enabled가 꺼져 있거나 제한 모드여도 이렇게 보입니다. 목록과 테스트는 그대로 쓸 수 있습니다.',
  'origin-invalid':
    'origin이 GitHub 저장소를 가리키지 않습니다. 터미널에서 아래 명령으로 내 포크를 지정하세요. 목록과 테스트는 그대로 쓸 수 있습니다.',
  'official-clone':
    '공식 저장소를 그대로 받은 폴더라 제출할 수 없습니다. 포크한 뒤 터미널에서 아래 명령으로 origin을 바꾸거나 내 포크를 새로 클론하세요. 목록과 테스트는 그대로 쓸 수 있습니다.',
  'other-origin':
    'origin이 DaleStudy/leetcode-study의 포크가 아니라 제출할 수 없습니다. 내 포크를 origin으로 지정하세요. 목록과 테스트는 그대로 쓸 수 있습니다.',
  'sign-in': 'GitHub 로그인이 필요합니다. 로그인하면 내 포크를 확인합니다.',
  retry: 'GitHub 확인에 실패했습니다. 네트워크를 확인한 뒤 다시 시도하세요.',
};

/** origin을 직접 고쳐야 하는 상태에서만 복사할 수 있는 명령을 함께 보여 줍니다. */
const FORK_SHOWS_COMMAND: ReadonlySet<ForkNotice> = new Set(['origin-invalid', 'official-clone']);

/** 설명 아래에 한 줄 명령을 선택하기 쉬운 코드 요소로 붙입니다. 명령이 필요 없는 상태에는 아무것도 만들지 않습니다. */
function commandHint(notice: ForkNotice): HTMLElement[] {
  return FORK_SHOWS_COMMAND.has(notice)
    ? [element('code', 'onboarding-command', REMOTE_COMMAND)]
    : [];
}

/** 제출 준비 상태별로 보여 줄 버튼입니다. 해결 방법이 없는 상태에는 버튼이 없습니다. */
const FORK_ACTIONS: Record<ForkNotice, readonly OnboardingAction[]> = {
  checking: [],
  verified: [],
  'no-git': ['openForkPage', 'cloneRepository', 'recheck'],
  'origin-invalid': ['recheck'],
  'official-clone': ['openForkPage', 'cloneRepository', 'recheck'],
  'other-origin': ['openForkPage', 'cloneRepository', 'recheck'],
  'sign-in': [],
  retry: ['recheck'],
};

const ACTION_LABEL: Record<OnboardingAction, string> = {
  openFolder: '폴더 열기',
  cloneRepository: '내 포크 클론',
  openForkPage: '포크 만들기',
  openNestedFolder: '열기',
  recheck: '다시 확인',
};

/** 온보딩 버튼을 만들고 클릭 시 호스트에 동작을 요청합니다. 작업 중에는 비활성화합니다. */
function onboardingButton(
  context: ViewContext,
  action: OnboardingAction,
  options: { label?: string; target?: string; primary?: boolean } = {},
): HTMLButtonElement {
  return actionButton({
    className: options.primary ? 'primary-button' : 'secondary-button',
    label: options.label ?? ACTION_LABEL[action],
    disabled: context.ui.busy,
    onClick: () => {
      context.post({
        type: 'onboarding',
        action,
        ...(options.target === undefined ? {} : { target: options.target }),
      });
    },
  });
}

/** 설명 문단과 버튼 줄을 가진 카드 뼈대를 만듭니다. */
function card(label: string, className: string): HTMLElement {
  const section = element('section', `onboarding-card ${className}`);
  section.setAttribute('aria-label', label);
  return section;
}

/** 버튼들을 한 줄로 묶습니다. 버튼이 없으면 빈 요소를 만들지 않습니다. */
function actions(...buttons: HTMLButtonElement[]): HTMLElement[] {
  if (buttons.length === 0) {
    return [];
  }
  const row = element('div', 'onboarding-actions');
  row.append(...buttons);
  return [row];
}

/** 열린 폴더가 없거나 비어 있을 때 포크·클론·폴더 열기 순서를 보여 줍니다. */
function renderGettingStarted(context: ViewContext, empty: boolean): HTMLElement {
  const section = card('스터디 저장소 준비', 'onboarding-start');
  section.append(
    element('h2', 'onboarding-title', empty ? '빈 폴더입니다' : '스터디 저장소를 열어 보세요'),
    element(
      'p',
      'onboarding-text',
      empty
        ? '내 포크를 받아 오면 문제 목록이 나타납니다.'
        : 'DaleStudy/leetcode-study를 포크해 클론한 폴더를 열면 문제 목록이 나타납니다.',
    ),
  );
  const steps = element('ol', 'onboarding-steps');
  const rows: [string, HTMLButtonElement][] = [
    ['GitHub에서 포크 만들기', onboardingButton(context, 'openForkPage')],
    ['내 포크 클론하기', onboardingButton(context, 'cloneRepository', { primary: true })],
  ];
  if (!empty) {
    rows.push(['클론한 폴더 열기', onboardingButton(context, 'openFolder')]);
  }
  for (const [label, button] of rows) {
    const item = element('li', 'onboarding-step');
    item.append(element('span', 'onboarding-step-label', label), button);
    steps.append(item);
  }
  section.append(steps);
  return section;
}

/** 열린 폴더 바로 아래의 스터디 저장소 후보를 각각 열 수 있게 보여 줍니다. */
function renderNested(context: ViewContext): HTMLElement {
  const section = card('하위 스터디 저장소', 'onboarding-nested');
  section.append(
    element('h2', 'onboarding-title', '열린 폴더 안에 스터디 저장소가 있습니다'),
    element('p', 'onboarding-text', '저장소 폴더를 직접 열면 문제 목록이 나타납니다.'),
  );
  const list = element('div', 'onboarding-actions onboarding-actions-column');
  for (const folder of context.state.workspace.nestedStudyFolders) {
    list.append(
      onboardingButton(context, 'openNestedFolder', {
        label: `${folder.name} 열기`,
        target: folder.uri,
        primary: true,
      }),
    );
  }
  section.append(list);
  return section;
}

/** 스터디와 무관한 프로젝트에서는 한 줄 안내와 폴더 열기 버튼만 보여 줍니다. */
function renderOther(context: ViewContext): HTMLElement {
  const section = card('스터디 저장소 아님', 'onboarding-quiet');
  section.append(
    element(
      'p',
      'onboarding-text',
      '이 폴더는 DaleStudy 리트코드 스터디 저장소가 아닙니다. 스터디 폴더를 열면 문제 목록이 나타납니다.',
    ),
    ...actions(onboardingButton(context, 'openFolder')),
  );
  return section;
}

/** 카탈로그를 읽지 못했을 때 아래 오류 영역을 확인하고 다시 시도하게 안내합니다. */
function renderBroken(context: ViewContext): HTMLElement {
  const section = card('스터디 저장소 읽기 실패', 'onboarding-broken');
  section.append(
    element('h2', 'onboarding-title', '스터디 저장소를 읽지 못했습니다'),
    element('p', 'onboarding-text', '아래 오류를 확인해 고친 뒤 다시 확인하세요.'),
    ...actions(onboardingButton(context, 'recheck', { primary: true })),
  );
  return section;
}

/** 체크리스트 한 줄의 표식, 이름과 필요한 설명·버튼을 만듭니다. */
function renderStep(
  context: ViewContext,
  study: StudyOnboarding,
  step: OnboardingStep,
): HTMLElement {
  const item = element('li', 'onboarding-step');
  item.dataset.status = step.status;
  item.dataset.step = step.id;
  const marker = STATUS_MARKER[step.status];
  const symbol = element('span', 'onboarding-marker', marker.symbol);
  symbol.setAttribute('role', 'img');
  symbol.setAttribute('aria-label', marker.label);
  const body = element('div', 'onboarding-step-body');
  body.append(element('span', 'onboarding-step-label', STEP_LABEL[step.id]));
  const buttons: HTMLButtonElement[] = [];

  if (step.id === 'profile' && step.status === 'current') {
    body.append(element('p', 'onboarding-hint', '아래 설정에 닉네임을 입력하고 적용을 누르세요.'));
  } else if (step.id === 'first-solution') {
    if (step.status === 'current' && study.firstProblem) {
      const title = formatProblemTitle(study.firstProblem.slug);
      body.append(element('p', 'onboarding-hint', `${title}부터 시작해 보세요.`));
      const create = actionButton({
        className: 'primary-button',
        label: '풀이 만들기',
        disabled: context.ui.busy || !study.canCreateFile,
        title: study.canCreateFile
          ? undefined
          : '신뢰한 워크스페이스에서만 파일을 만들 수 있습니다.',
        onClick: () => {
          context.post({
            type: 'createSolution',
            rootUri: study.rootUri,
            slug: study.firstProblem!.slug,
          });
        },
      });
      buttons.push(create);
    } else if (step.status === 'todo') {
      body.append(element('p', 'onboarding-hint', '닉네임을 설정하면 시작할 수 있습니다.'));
    }
  } else if (step.id === 'submission' && step.status !== 'done') {
    body.append(
      element('p', 'onboarding-hint', FORK_DETAIL[study.fork]),
      ...commandHint(study.fork),
    );
    if (study.forkReason && step.status === 'warning') {
      body.append(element('p', 'onboarding-reason', study.forkReason));
    }
    if (study.fork === 'sign-in') {
      buttons.push(
        actionButton({
          className: 'primary-button',
          label: 'GitHub 로그인',
          disabled: context.ui.busy,
          onClick: () => context.post({ type: 'signInGitHub' }),
        }),
      );
    }
    for (const action of FORK_ACTIONS[study.fork]) {
      buttons.push(onboardingButton(context, action));
    }
  }
  body.append(...actions(...buttons));
  item.append(symbol, body);
  return item;
}

/** 아직 시작하지 않은 사용자에게 네 단계를 접을 수 있는 카드로 보여 줍니다. */
function renderChecklist(context: ViewContext, study: StudyOnboarding): HTMLElement {
  const section = card('시작하기', 'onboarding-checklist');
  const details = element('details', 'onboarding-details');
  details.open = !context.ui.onboardingCollapsed;
  details.addEventListener('toggle', () => {
    context.ui.onboardingCollapsed = !details.open;
  });
  const done = study.steps.filter(({ status }) => status === 'done').length;
  details.append(
    element('summary', 'onboarding-summary', `시작하기 · ${done}/${study.steps.length} 완료`),
  );
  const list = element('ol', 'onboarding-steps');
  list.append(...study.steps.map((step) => renderStep(context, study, step)));
  details.append(list);
  section.append(details);
  return section;
}

/** 시작을 마친 사용자에게 확정된 제출 문제만 한 줄 경고로 남깁니다. */
function renderWarning(context: ViewContext, study: StudyOnboarding): HTMLElement {
  const section = card('제출 준비 확인', 'onboarding-warning');
  section.setAttribute('role', 'note');
  const step = study.steps.find(({ id }) => id === 'submission');
  const item = element('div', 'onboarding-step-body');
  item.append(element('p', 'onboarding-text', FORK_DETAIL[study.fork]), ...commandHint(study.fork));
  if (study.forkReason && step?.status === 'warning') {
    item.append(element('p', 'onboarding-reason', study.forkReason));
  }
  const buttons: HTMLButtonElement[] = [];
  if (study.fork === 'sign-in') {
    buttons.push(
      actionButton({
        className: 'primary-button',
        label: 'GitHub 로그인',
        disabled: context.ui.busy,
        onClick: () => context.post({ type: 'signInGitHub' }),
      }),
    );
  }
  for (const action of FORK_ACTIONS[study.fork]) {
    buttons.push(onboardingButton(context, action));
  }
  item.append(...actions(...buttons));
  section.append(item);
  return section;
}

/**
 * 온보딩 모델을 안내 카드로 그립니다. 폴더 종류마다 카드가 하나이며, 보여 줄 것이 없으면 빈 배열입니다.
 * 버튼은 호스트에 동작을 요청할 뿐이고 가능 여부와 대상은 호스트가 다시 검증합니다.
 */
export function renderOnboarding(context: ViewContext, model: OnboardingModel): HTMLElement[] {
  switch (model.kind) {
    case 'none':
      return [renderGettingStarted(context, false)];
    case 'empty':
      return [renderGettingStarted(context, true)];
    case 'nested':
      return [renderNested(context)];
    case 'other':
      return [renderOther(context)];
    case 'broken':
      return [renderBroken(context)];
    case 'study': {
      const { study } = model;
      if (!study || study.layout === 'hidden') {
        return [];
      }
      return [
        study.layout === 'checklist'
          ? renderChecklist(context, study)
          : renderWarning(context, study),
      ];
    }
  }
}
