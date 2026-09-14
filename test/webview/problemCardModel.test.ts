import { describe, expect, it } from 'vitest';
import type {
  ExtensionSnapshot,
  ProblemSnapshot,
  RepositorySnapshot,
} from '../../src/shared/contracts';
import { problemCardModel } from '../../src/webview/state/problemCardModel';
import type { UiState, ViewContext } from '../../src/webview/state/viewTypes';

const ui: UiState = {
  query: '',
  filter: 'all',
  groupBy: 'week',
  unpushedOnly: false,
  viewMode: 'list',
  busy: false,
};

const state: ExtensionSnapshot = {
  nickname: 'CaseUser',
  preferredLanguage: 'python3',
  languages: [
    { id: 'python3', label: 'Python 3', extension: 'py' },
    { id: 'typescript', label: 'TypeScript', extension: 'ts' },
  ],
  repositories: [],
  issues: [],
  workspaceTrusted: true,
};

const incomplete: ProblemSnapshot = {
  slug: 'three-sum',
  week: 2,
  difficulty: 'Medium',
  categories: [],
  blindCategories: [],
  completed: false,
  hasOtherSolutions: false,
  solutions: [],
};

const completed: ProblemSnapshot = {
  slug: 'two-sum',
  week: 1,
  difficulty: 'Easy',
  categories: [],
  blindCategories: [],
  solutionUrl: 'https://www.algodale.com/problems/two-sum/',
  completed: true,
  hasOtherSolutions: true,
  solutions: [
    {
      name: 'CaseUser.ts',
      uri: 'file:///study/two-sum/CaseUser.ts',
      gitStatus: 'unpushed',
      submissionStatus: 'working',
    },
    {
      name: 'CaseUser.py',
      uri: 'file:///study/two-sum/CaseUser.py',
      gitStatus: 'pushed',
      submissionStatus: 'working',
    },
  ],
};

function repository(problem: ProblemSnapshot, verified = true): RepositorySnapshot {
  return {
    name: 'study',
    rootUri: 'file:///study',
    gitRemote: 'origin',
    problems: [problem],
    submission: verified
      ? {
          status: 'ready',
          fork: {
            status: 'verified',
            owner: 'CaseUser',
            repository: 'leetcode-study',
            originUrl: 'https://github.com/CaseUser/leetcode-study.git',
          },
          stagedFiles: [],
          otherStagedFiles: [],
          pendingCommits: [],
          forkFiles: [],
          otherForkFiles: [],
          summary: {
            working: 1,
            staged: 0,
            pushNeeded: 0,
            prPending: 0,
            merged: 0,
            unknown: 0,
          },
          canSync: true,
          canReturnToMain: false,
          hasCanonicalRemote: true,
          behindOfficialMain: false,
          blockingTrackedFiles: [],
        }
      : undefined,
  };
}

function context(overrides: Partial<ViewContext> = {}): ViewContext {
  return { state, ui, post: () => undefined, ...overrides };
}

describe('problemCardModel', () => {
  it('creates an incomplete card that cannot be staged', () => {
    const model = problemCardModel(incomplete, repository(incomplete), context());
    expect(model.primary.kind).toBe('create');
    expect(model.status.kind).toBe('no-file');
    expect(model.stage).toBeUndefined();
    expect(model.answer.disabled).toBe(true);
  });

  it('prefers the configured language and exposes extra files in that order', () => {
    const model = problemCardModel(completed, repository(completed), context());
    expect(model.primary).toMatchObject({ kind: 'open', uri: 'file:///study/two-sum/CaseUser.py' });
    expect(model.extraSolutions?.map(({ extension, preferred }) => [extension, preferred])).toEqual(
      [
        ['.py', true],
        ['.ts', false],
      ],
    );
    expect(model.stage?.staged).toBe(false);
  });

  it('hides stage actions when the fork is not verified', () => {
    const model = problemCardModel(completed, repository(completed, false), context());
    expect(model.stage).toBeUndefined();
    expect(model.extraSolutions?.every((file) => file.stage === undefined)).toBe(true);
  });

  it('blocks creation in an untrusted workspace', () => {
    const model = problemCardModel(
      incomplete,
      repository(incomplete),
      context({ state: { ...state, workspaceTrusted: false } }),
    );
    expect(model.primary).toMatchObject({
      kind: 'create',
      disabled: true,
      title: '파일을 만들려면 워크스페이스를 신뢰해야 합니다.',
    });
    expect(model.status).toMatchObject({ kind: 'no-file', hint: '워크스페이스 신뢰 후 생성' });
  });
});
