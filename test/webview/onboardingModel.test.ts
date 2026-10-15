import { describe, expect, it } from 'vitest';
import type {
  ExtensionSnapshot,
  ForkIdentitySnapshot,
  ProblemSnapshot,
  RepositorySnapshot,
  WorkspaceKind,
} from '../../src/shared/contracts';
import {
  forkNotice,
  onboardingModel,
  pickFirstProblem,
  type ForkNotice,
} from '../../src/webview/state/onboardingModel';

function problem(slug: string, extra: Partial<ProblemSnapshot> = {}): ProblemSnapshot {
  return {
    slug,
    difficulty: 'Easy',
    categories: [],
    blindCategories: [],
    completed: false,
    hasOtherSolutions: false,
    solutions: [],
    ...extra,
  };
}

function repository(
  fork: ForkIdentitySnapshot | undefined,
  extra: Partial<RepositorySnapshot> = {},
): RepositorySnapshot {
  return {
    name: 'study',
    rootUri: 'file:///study',
    problems: [problem('valid-anagram', { week: 1 })],
    ...(fork ? { submission: { fork } as unknown as RepositorySnapshot['submission'] } : {}),
    ...extra,
  };
}

function snapshot(
  kind: WorkspaceKind,
  overrides: Partial<ExtensionSnapshot> = {},
): ExtensionSnapshot {
  return {
    nickname: '',
    preferredLanguage: 'python3',
    languages: [],
    repositories: [],
    issues: [],
    workspace: { kind, nestedStudyFolders: [] },
    workspaceTrusted: true,
    ...overrides,
  };
}

const VERIFIED: ForkIdentitySnapshot = {
  status: 'verified',
  owner: 'me',
  repository: 'leetcode-study',
};

describe('forkNotice', () => {
  const cases: [string, RepositorySnapshot, ForkNotice][] = [
    ['no Git lookup yet', repository(undefined), 'checking'],
    ['Git discovery still running', repository(undefined, { hasGit: undefined }), 'checking'],
    ['GitHub lookup in progress', repository({ status: 'checking' }), 'checking'],
    ['folder is not a Git repository', repository(undefined, { hasGit: false }), 'no-git'],
    [
      'origin missing or not a GitHub repository',
      repository({ status: 'unsupported', reason: 'origin 없음' }),
      'origin-invalid',
    ],
    [
      'origin is the official repository',
      repository({
        status: 'unsupported',
        originUrl: 'https://github.com/DaleStudy/leetcode-study.git',
        owner: 'DaleStudy',
        repository: 'leetcode-study',
      }),
      'official-clone',
    ],
    [
      'official repository with different casing',
      repository({
        status: 'unsupported',
        originUrl: 'https://github.com/dalestudy/Leetcode-Study.git',
        owner: 'dalestudy',
        repository: 'Leetcode-Study',
      }),
      'official-clone',
    ],
    [
      'origin is some other repository',
      repository({
        status: 'unsupported',
        originUrl: 'https://github.com/me/other.git',
        owner: 'me',
        repository: 'other',
      }),
      'other-origin',
    ],
    [
      'GitHub requires sign-in',
      repository({ status: 'unavailable', needsGitHubSignIn: true }),
      'sign-in',
    ],
    [
      'GitHub lookup failed for another reason',
      repository({ status: 'unavailable', reason: 'offline' }),
      'retry',
    ],
    ['origin is a verified fork', repository(VERIFIED, { hasGit: true }), 'verified'],
  ];

  it.each(cases)('maps %s', (_name, repo, expected) => {
    expect(forkNotice(repo).notice).toBe(expected);
  });

  it('keeps the unavailable reason for display', () => {
    expect(forkNotice(repository({ status: 'unavailable', reason: 'offline' })).reason).toBe(
      'offline',
    );
  });
});

describe('pickFirstProblem', () => {
  it('prefers the earliest week, then easier problems, then name', () => {
    const picked = pickFirstProblem([
      problem('zeta', { week: 2 }),
      problem('hard-one', { week: 1, difficulty: 'Hard' }),
      problem('medium-one', { week: 1, difficulty: 'Medium' }),
      problem('beta', { week: 1 }),
      problem('alpha', { week: 1 }),
      problem('unscheduled'),
    ]);
    expect(picked?.slug).toBe('alpha');
  });

  it('sorts unscheduled problems last and tolerates an empty list', () => {
    expect(pickFirstProblem([problem('b'), problem('a', { week: 9 })])?.slug).toBe('a');
    expect(pickFirstProblem([])).toBeUndefined();
  });
});

describe('onboardingModel outside a study repository', () => {
  it.each<WorkspaceKind>(['none', 'empty', 'nested', 'other', 'broken'])(
    'shows only the %s guide and hides the settings form',
    (kind) => {
      const model = onboardingModel(snapshot(kind), undefined);
      expect(model.kind).toBe(kind);
      expect(model.showSettings).toBe(false);
      expect(model.study).toBeUndefined();
    },
  );

  it('does not trust a study kind that has no repository', () => {
    expect(onboardingModel(snapshot('study'), undefined).kind).toBe('none');
  });
});

describe('onboardingModel in a study repository', () => {
  const study = (
    repo: RepositorySnapshot,
    overrides: Partial<ExtensionSnapshot> = {},
  ): ExtensionSnapshot => snapshot('study', { repositories: [repo], ...overrides });

  it('walks a new user through nickname, first solution and submission', () => {
    const model = onboardingModel(study(repository(VERIFIED, { hasGit: true })), undefined);
    expect(model.showSettings).toBe(true);
    expect(model.study?.layout).toBe('checklist');
    expect(model.study?.steps.map(({ id, status }) => [id, status])).toEqual([
      ['repository', 'done'],
      ['profile', 'current'],
      ['first-solution', 'todo'],
      ['submission', 'done'],
    ]);
    expect(model.study?.firstProblem?.slug).toBe('valid-anagram');
  });

  it('moves to the first solution once the nickname is set', () => {
    const model = onboardingModel(
      study(repository(VERIFIED, { hasGit: true }), { nickname: 'me' }),
      undefined,
    );
    expect(model.study?.steps.map(({ status }) => status)).toEqual([
      'done',
      'done',
      'current',
      'done',
    ]);
  });

  it('hides the card for a finished user with a verified fork', () => {
    const done = repository(VERIFIED, {
      hasGit: true,
      problems: [problem('valid-anagram', { week: 1, completed: true })],
    });
    const model = onboardingModel(study(done, { nickname: 'me' }), undefined);
    expect(model.study?.layout).toBe('hidden');
    expect(model.study?.firstProblem).toBeUndefined();
  });

  it('does not flash a checking or transient state at a finished user', () => {
    const solved = [problem('valid-anagram', { week: 1, completed: true })];
    for (const fork of [
      undefined,
      { status: 'checking' } as const,
      { status: 'unavailable' } as const,
    ]) {
      const model = onboardingModel(
        study(repository(fork, { problems: solved }), { nickname: 'me' }),
        undefined,
      );
      expect(model.study?.layout).toBe('hidden');
    }
  });

  it.each<[string, RepositorySnapshot, ForkNotice]>([
    ['no Git', repository(undefined, { hasGit: false }), 'no-git'],
    ['invalid origin', repository({ status: 'unsupported' }), 'origin-invalid'],
    [
      'official clone',
      repository({
        status: 'unsupported',
        originUrl: 'x',
        owner: 'DaleStudy',
        repository: 'leetcode-study',
      }),
      'official-clone',
    ],
    [
      'other origin',
      repository({ status: 'unsupported', originUrl: 'x', owner: 'me', repository: 'o' }),
      'other-origin',
    ],
    ['sign-in', repository({ status: 'unavailable', needsGitHubSignIn: true }), 'sign-in'],
  ])('keeps a one-line warning for a finished user with %s', (_name, repo, notice) => {
    const solved = { ...repo, problems: [problem('valid-anagram', { week: 1, completed: true })] };
    const model = onboardingModel(study(solved, { nickname: 'me' }), undefined);
    expect(model.study?.layout).toBe('warning');
    expect(model.study?.fork).toBe(notice);
  });

  it('marks submission readiness per fork state in the checklist', () => {
    const statusFor = (repo: RepositorySnapshot) =>
      onboardingModel(study(repo), undefined).study?.steps.at(-1)?.status;
    expect(statusFor(repository({ status: 'checking' }))).toBe('checking');
    expect(statusFor(repository({ status: 'unavailable' }))).toBe('todo');
    expect(statusFor(repository({ status: 'unavailable', needsGitHubSignIn: true }))).toBe(
      'current',
    );
    expect(statusFor(repository({ status: 'unsupported' }))).toBe('warning');
  });

  it('blocks file creation in an untrusted workspace', () => {
    const model = onboardingModel(
      study(repository(VERIFIED), { nickname: 'me', workspaceTrusted: false }),
      undefined,
    );
    expect(model.study?.canCreateFile).toBe(false);
  });

  it('counts a solution in any repository and follows the selected repository', () => {
    const other: RepositorySnapshot = {
      name: 'other',
      rootUri: 'file:///other',
      problems: [problem('x', { week: 1, completed: true })],
    };
    const model = onboardingModel(
      snapshot('study', {
        nickname: 'me',
        repositories: [repository({ status: 'unsupported' }), other],
      }),
      'file:///other',
    );
    expect(model.study?.rootUri).toBe('file:///other');
    expect(model.study?.steps[2]?.status).toBe('done');
  });
});
