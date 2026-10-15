// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ExtensionSnapshot,
  ForkIdentitySnapshot,
  WorkspaceKind,
  WorkspaceSnapshot,
} from '../../src/shared/contracts';
import { renderApp, type PostMessage, type UiState } from '../../src/webview/render';
import { createSnapshot, submissionSnapshot } from './renderFixtures';

const VERIFIED_FORK: ForkIdentitySnapshot = {
  status: 'verified',
  owner: 'CaseUser',
  repository: 'leetcode-study',
  originUrl: 'https://github.com/CaseUser/leetcode-study.git',
};

/** 지원 저장소가 없는 폴더 종류의 스냅샷입니다. */
function withoutRepository(
  kind: WorkspaceKind,
  workspace: Partial<WorkspaceSnapshot> = {},
): ExtensionSnapshot {
  return {
    ...createSnapshot(),
    nickname: '',
    repositories: [],
    workspace: { kind, nestedStudyFolders: [], ...workspace },
  };
}

/** 닉네임·풀이가 없는 새 사용자의 지원 저장소 스냅샷입니다. */
function newUser(fork: ForkIdentitySnapshot | null = VERIFIED_FORK): ExtensionSnapshot {
  const snapshot = submissionSnapshot();
  const [repository] = snapshot.repositories;
  return {
    ...snapshot,
    nickname: '',
    repositories: [
      {
        ...repository!,
        hasGit: true,
        problems: repository!.problems.map((problem) => ({
          ...problem,
          completed: false,
          solutions: [],
        })),
        submission: fork ? { ...repository!.submission!, fork } : undefined,
      },
    ],
  };
}

/** 한 번 풀이를 만든 기존 사용자의 스냅샷에 포크 상태만 바꿔 끼웁니다. */
function veteran(fork: ForkIdentitySnapshot | undefined): ExtensionSnapshot {
  const snapshot = submissionSnapshot();
  const [repository] = snapshot.repositories;
  return {
    ...snapshot,
    repositories: [
      {
        ...repository!,
        hasGit: true,
        submission: fork ? { ...repository!.submission!, fork } : undefined,
      },
    ],
  };
}

function buttonLabels(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.onboarding-card button')].map(
    ({ textContent }) => textContent ?? '',
  );
}

function clickButton(root: HTMLElement, label: string): void {
  const button = [...root.querySelectorAll<HTMLButtonElement>('.onboarding-card button')].find(
    ({ textContent }) => textContent === label,
  );
  expect(button, `button ${label}`).toBeDefined();
  button!.click();
}

describe('webview onboarding', () => {
  let root: HTMLElement;
  let ui: UiState;
  let post: ReturnType<typeof vi.fn<PostMessage>>;
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector('#app')!;
    ui = {
      query: '',
      filter: 'all',
      groupBy: 'week',
      unpushedOnly: false,
      viewMode: 'list',
      busy: false,
    };
    post = vi.fn<PostMessage>();
  });

  describe('outside a study repository', () => {
    it('guides a user with no folder open through fork, clone and open', () => {
      renderApp(root, withoutRepository('none'), ui, post);
      expect(root.textContent).toContain('스터디 저장소를 열어 보세요');
      expect(buttonLabels(root)).toEqual(['포크 만들기', '내 포크 클론', '폴더 열기']);
      expect(root.querySelector('.settings-panel')).toBeNull();
      expect(root.querySelector('.app-controls-region')?.hasAttribute('hidden')).toBe(true);

      clickButton(root, '포크 만들기');
      clickButton(root, '내 포크 클론');
      clickButton(root, '폴더 열기');
      expect(post.mock.calls).toEqual([
        [{ type: 'onboarding', action: 'openForkPage' }],
        [{ type: 'onboarding', action: 'cloneRepository' }],
        [{ type: 'onboarding', action: 'openFolder' }],
      ]);
    });

    it('tells the user an empty folder is empty and only offers fork and clone', () => {
      renderApp(root, withoutRepository('empty'), ui, post);
      expect(root.textContent).toContain('빈 폴더입니다');
      expect(buttonLabels(root)).toEqual(['포크 만들기', '내 포크 클론']);
    });

    it('offers each nested study folder with its URI as the target', () => {
      const nested = [
        { name: 'leetcode-study', uri: 'file:///dev/leetcode-study' },
        { name: 'leetcode-study-2', uri: 'file:///dev/leetcode-study-2' },
      ];
      renderApp(root, withoutRepository('nested', { nestedStudyFolders: nested }), ui, post);
      expect(buttonLabels(root)).toEqual(['leetcode-study 열기', 'leetcode-study-2 열기']);
      clickButton(root, 'leetcode-study-2 열기');
      expect(post).toHaveBeenCalledWith({
        type: 'onboarding',
        action: 'openNestedFolder',
        target: 'file:///dev/leetcode-study-2',
      });
    });

    it('stays quiet in an unrelated project: one line, one button, no form', () => {
      renderApp(root, withoutRepository('other'), ui, post);
      expect(root.querySelectorAll('.onboarding-card')).toHaveLength(1);
      expect(root.querySelector('.onboarding-quiet')).not.toBeNull();
      expect(root.textContent).toContain('스터디 저장소가 아닙니다');
      expect(buttonLabels(root)).toEqual(['폴더 열기']);
      expect(root.querySelector('#nickname')).toBeNull();
      expect(root.querySelector('.telemetry-settings')).toBeNull();
    });

    it('shows the scan error and a recheck button for a broken repository', () => {
      const snapshot = {
        ...withoutRepository('broken'),
        issues: [{ rootName: 'study', message: 'problem-categories.json이 올바르지 않습니다.' }],
      };
      renderApp(root, snapshot, ui, post);
      expect(root.textContent).toContain('스터디 저장소를 읽지 못했습니다');
      expect(root.querySelector('.issue')?.textContent).toContain('올바르지 않습니다');
      clickButton(root, '다시 확인');
      expect(post).toHaveBeenCalledWith({ type: 'onboarding', action: 'recheck' });
    });

    it('disables the buttons while a host action is running', () => {
      ui.busy = true;
      renderApp(root, withoutRepository('none'), ui, post);
      const buttons = [...root.querySelectorAll<HTMLButtonElement>('.onboarding-card button')];
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every(({ disabled }) => disabled)).toBe(true);
    });

    it('keeps the six app regions so partial updates keep working', () => {
      const replaceChildren = vi.spyOn(root, 'replaceChildren');
      renderApp(root, withoutRepository('other'), ui, post);
      expect(replaceChildren.mock.calls[0]).toHaveLength(6);
    });
  });

  describe('inside a study repository', () => {
    it('shows the four-step checklist to a new user and points at the settings form', () => {
      renderApp(root, newUser(), ui, post);
      expect(root.querySelector('.onboarding-summary')?.textContent).toBe('시작하기 · 2/4 완료');
      const statuses = [...root.querySelectorAll<HTMLElement>('.onboarding-step')].map(
        (item) => `${item.dataset.step}:${item.dataset.status}`,
      );
      expect(statuses).toEqual([
        'repository:done',
        'profile:current',
        'first-solution:todo',
        'submission:done',
      ]);
      expect(root.querySelector('#nickname')).not.toBeNull();
      expect(root.textContent).toContain('닉네임을 입력하고 적용을 누르세요');
      expect(root.textContent).toContain('닉네임을 설정하면 시작할 수 있습니다');
    });

    it('creates the first solution for the suggested problem', () => {
      renderApp(root, { ...newUser(), nickname: 'CaseUser' }, ui, post);
      expect(root.textContent).toContain('Two Sum부터 시작해 보세요');
      clickButton(root, '풀이 만들기');
      expect(post).toHaveBeenCalledWith({
        type: 'createSolution',
        rootUri: 'file:///study-a',
        slug: 'two-sum',
      });
    });

    it('does not allow creating a file in an untrusted workspace', () => {
      renderApp(root, { ...newUser(), nickname: 'CaseUser', workspaceTrusted: false }, ui, post);
      const create = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
        ({ textContent }) => textContent === '풀이 만들기',
      );
      expect(create?.disabled).toBe(true);
      expect(create?.title).toContain('신뢰');
    });

    it('stays neutral while the fork is being checked', () => {
      renderApp(root, newUser(null), ui, post);
      const submission = root.querySelector<HTMLElement>('[data-step="submission"]');
      expect(submission?.dataset.status).toBe('checking');
      expect(submission?.textContent).toContain('확인하고 있습니다');
      expect(root.querySelector('.onboarding-warning')).toBeNull();
    });

    it('remembers a collapsed checklist across state updates', () => {
      renderApp(root, newUser(), ui, post);
      const details = root.querySelector<HTMLDetailsElement>('.onboarding-details')!;
      expect(details.open).toBe(true);
      details.open = false;
      details.dispatchEvent(new Event('toggle'));
      expect(ui.onboardingCollapsed).toBe(true);

      renderApp(root, { ...newUser(), nickname: 'CaseUser' }, ui, post);
      expect(root.querySelector<HTMLDetailsElement>('.onboarding-details')?.open).toBe(false);
    });

    it('does not rebuild the settings form when only the onboarding card changes', () => {
      renderApp(root, newUser(null), ui, post);
      const input = root.querySelector<HTMLInputElement>('#nickname')!;
      input.value = 'typing';
      renderApp(root, newUser(VERIFIED_FORK), ui, post);
      expect(root.querySelector<HTMLInputElement>('#nickname')).toBe(input);
      expect(input.value).toBe('typing');
    });

    it('offers fork and clone help in the checklist for an official clone', () => {
      renderApp(
        root,
        newUser({
          status: 'unsupported',
          owner: 'DaleStudy',
          repository: 'leetcode-study',
          originUrl: 'https://github.com/DaleStudy/leetcode-study.git',
          reason: 'DaleStudy/leetcode-study에서 포크한 저장소가 아닙니다.',
        }),
        ui,
        post,
      );
      const submission = root.querySelector<HTMLElement>('[data-step="submission"]');
      expect(submission?.dataset.status).toBe('warning');
      expect(submission?.textContent).toContain('공식 저장소를 그대로 받은 폴더');
      expect(submission?.textContent).toContain('목록과 테스트는 그대로 쓸 수 있습니다');
      expect(submission?.querySelector('code.onboarding-command')?.textContent).toBe(
        'git remote set-url origin https://github.com/<내 아이디>/leetcode-study.git',
      );
      expect(buttonLabels(submission!)).toEqual(['포크 만들기', '내 포크 클론', '다시 확인']);
    });

    it('does not show the remote command for states it cannot fix', () => {
      renderApp(root, newUser({ status: 'unavailable', reason: 'offline' }), ui, post);
      expect(root.querySelector('.onboarding-command')).toBeNull();
    });

    it('shows a sign-in button that reuses the existing GitHub sign-in message', () => {
      renderApp(root, newUser({ status: 'unavailable', needsGitHubSignIn: true }), ui, post);
      clickButton(root, 'GitHub 로그인');
      expect(post).toHaveBeenCalledWith({ type: 'signInGitHub' });
    });

    it('offers a plain recheck for a transient GitHub failure', () => {
      renderApp(root, newUser({ status: 'unavailable', reason: 'offline' }), ui, post);
      expect(root.querySelector('[data-step="submission"]')?.getAttribute('data-status')).toBe(
        'todo',
      );
      clickButton(root, '다시 확인');
      expect(post).toHaveBeenCalledWith({ type: 'onboarding', action: 'recheck' });
    });

    it('says a folder without Git cannot submit, using the Git-less hint', () => {
      const snapshot = newUser(null);
      snapshot.repositories[0]!.hasGit = false;
      renderApp(root, snapshot, ui, post);
      expect(root.querySelector('[data-step="submission"]')?.textContent).toContain(
        'Git 저장소로 인식되지 않았습니다',
      );
    });
  });

  describe('for a user who already started', () => {
    it.each([
      ['verified fork', VERIFIED_FORK],
      ['fork still being checked', undefined],
      ['transient GitHub failure', { status: 'unavailable' } as ForkIdentitySnapshot],
    ])('shows nothing extra with a %s', (_name, fork) => {
      renderApp(root, veteran(fork), ui, post);
      expect(root.querySelector('.onboarding-card')).toBeNull();
    });

    it('keeps one warning line for a definitive submission problem', () => {
      renderApp(
        root,
        veteran({
          status: 'unsupported',
          owner: 'me',
          repository: 'other',
          originUrl: 'https://github.com/me/other.git',
          reason: 'DaleStudy/leetcode-study에서 포크한 저장소가 아닙니다.',
        }),
        ui,
        post,
      );
      expect(root.querySelectorAll('.onboarding-card')).toHaveLength(1);
      expect(root.querySelector('.onboarding-warning')).not.toBeNull();
      expect(root.querySelector('.onboarding-details')).toBeNull();
      expect(root.textContent).toContain('포크가 아니라 제출할 수 없습니다');
      expect(root.querySelector('.settings-panel')).not.toBeNull();
    });
  });
});
