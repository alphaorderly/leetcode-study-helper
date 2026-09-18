import type { ExtensionSnapshot } from '../../src/shared/contracts';

/** 테스트마다 독립된 화면 상태를 만들어 시나리오 간 변경이 전파되지 않게 합니다. */
export function createSnapshot(): ExtensionSnapshot {
  return {
    nickname: 'CaseUser',
    preferredLanguage: 'python3',
    languages: [
      { id: 'python3', label: 'Python 3', extension: 'py' },
      { id: 'typescript', label: 'TypeScript', extension: 'ts' },
    ],
    workspaceTrusted: true,
    issues: [],
    repositories: [
      {
        name: 'study-a',
        rootUri: 'file:///study-a',
        problems: [
          {
            slug: 'two-sum',
            week: 1,
            difficulty: 'Easy',
            categories: ['Array'],
            blindCategories: ['Array'],
            intendedApproach: 'Use a hash map.',
            solutionUrl: 'https://www.algodale.com/problems/two-sum/',
            completed: true,
            hasOtherSolutions: true,
            solutions: [
              {
                name: 'CaseUser.ts',
                uri: 'file:///study-a/two-sum/CaseUser.ts',
                gitStatus: 'unpushed',
              },
              {
                name: 'CaseUser.py',
                uri: 'file:///study-a/two-sum/CaseUser.py',
                gitStatus: 'pushed',
              },
            ],
          },
          {
            slug: 'three-sum',
            week: 2,
            difficulty: 'Medium',
            categories: ['Array', 'Two Pointers'],
            blindCategories: ['Array'],
            intendedApproach: 'Sort and use two pointers.',
            solutionUrl: 'https://www.algodale.com/problems/3sum/',
            completed: false,
            hasOtherSolutions: false,
            solutions: [],
          },
        ],
        gitRemote: 'origin',
      },
    ],
  };
}

export function createCurrentProblem() {
  return {
    rootUri: 'file:///study-a',
    slug: 'two-sum',
    solution: {
      name: 'CaseUser.py',
      uri: 'file:///study-a/two-sum/CaseUser.py',
      gitStatus: 'pushed' as const,
    },
    runner: {
      status: 'ready' as const,
      candidates: [
        {
          id: 'c0m0',
          label: 'Solution #1 · twoSum · 1번째 줄',
          classLine: 1,
          methodLine: 2,
        },
      ],
      selectedCandidateId: 'c0m0',
    },
  };
}

export function submissionSnapshot(): ExtensionSnapshot {
  const snapshot = createSnapshot();
  const repository = snapshot.repositories[0]!;
  const problem = repository.problems[0]!;
  const typescript = problem.solutions[0]!;
  const python = problem.solutions[1]!;
  const stagedFile = {
    name: typescript.name,
    uri: typescript.uri,
    relativePath: 'two-sum/CaseUser.ts',
    slug: 'two-sum',
    week: 1,
  };
  const pushedFile = {
    name: python.name,
    uri: python.uri,
    relativePath: 'two-sum/CaseUser.py',
    slug: 'two-sum',
    week: 1,
  };
  return {
    ...snapshot,
    repositories: [
      {
        ...repository,
        submission: {
          status: 'ready',
          branch: 'main',
          submissionBranch: 'week-01',
          activeSubmissionWeek: 1,
          fork: {
            status: 'verified',
            owner: 'CaseUser',
            repository: 'leetcode-study',
            originUrl: 'https://github.com/CaseUser/leetcode-study.git',
          },
          stagedFiles: [stagedFile],
          otherStagedFiles: [],
          pendingCommits: [
            {
              hash: '1234567890abcdef',
              shortHash: '1234567',
              message: '[CaseUser] WEEK 01 Solutions',
              pushed: true,
              files: [pushedFile],
              otherFiles: [],
            },
          ],
          forkFiles: [pushedFile],
          otherForkFiles: [],
          activePullRequest: {
            number: 77,
            title: '[CaseUser] WEEK 01 Solutions',
            url: 'https://github.com/DaleStudy/leetcode-study/pull/77',
            week: 1,
            branch: 'week-01',
            status: 'open',
          },
          pullRequest: {
            number: 77,
            title: '[CaseUser] WEEK 01 Solutions',
            url: 'https://github.com/DaleStudy/leetcode-study/pull/77',
            week: 1,
            branch: 'week-01',
            status: 'open',
          },
          summary: {
            working: 0,
            staged: 1,
            pushNeeded: 0,
            prPending: 1,
            merged: 0,
            unknown: 0,
          },
          canSync: false,
          canReturnToMain: false,
          hasCanonicalRemote: true,
          behindOfficialMain: false,
          blockingTrackedFiles: [],
        },
        problems: [
          {
            ...problem,
            solutions: [
              { ...typescript, submissionStatus: 'staged' },
              { ...python, submissionStatus: 'pr-open', pullRequestNumber: 77 },
            ],
          },
          repository.problems[1]!,
        ],
      },
    ],
  };
}
