// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSnapshot } from '../../src/core/types';

const baseSnapshot: ExtensionSnapshot = {
  nickname: 'CaseUser',
  preferredLanguage: 'python3',
  languages: [{ id: 'python3', label: 'Python 3', extension: 'py' }],
  repositories: [{
    name: 'study-a',
    rootUri: 'file:///study-a',
    problems: [{
      slug: 'two-sum',
      week: 1,
      difficulty: 'Easy',
      categories: [],
      blindCategories: [],
      solutionUrl: 'https://www.algodale.com/problems/two-sum/',
      completed: true,
      hasOtherSolutions: true,
      solutions: [{
        name: 'CaseUser.py',
        uri: 'file:///study-a/two-sum/CaseUser.py',
        gitStatus: 'pushed',
      }],
    }],
  }],
  issues: [],
  workspaceTrusted: true,
};

const currentProblem = {
  rootUri: 'file:///study-a',
  slug: 'two-sum',
  solution: {
    name: 'CaseUser.py',
    uri: 'file:///study-a/two-sum/CaseUser.py',
    gitStatus: 'pushed' as const,
  },
  status: 'idle' as const,
  runner: { status: 'checking' as const },
};

describe('webview state rendering', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<main id="app"></main>';
  });

  it('applies current-problem messages without replacing the list shell', async () => {
    const postMessage = vi.fn();
    const setState = vi.fn();
    vi.stubGlobal('acquireVsCodeApi', () => ({
      postMessage,
      getState: () => undefined,
      setState,
    }));

    await import('../../src/webview/main.js');
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'state', state: baseSnapshot },
    }));
    const search = document.querySelector('#problem-search');
    const problemCard = document.querySelector('.problem-card');

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'currentProblem', currentProblem },
    }));

    expect(document.querySelector('#problem-search')).toBe(search);
    expect(document.querySelector('.problem-card')).toBe(problemCard);
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
    expect(setState).toHaveBeenCalled();
  });
});
