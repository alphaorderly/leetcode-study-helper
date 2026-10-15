import { describe, expect, it } from 'vitest';
import type { ExtensionSnapshot } from '../../src/shared/contracts';
import {
  currentProblemTabModel,
  hasRepositories,
  listChromeHidden,
} from '../../src/webview/state/shellModel';
import type { UiState } from '../../src/webview/state/viewTypes';

const ui: UiState = {
  query: '',
  filter: 'all',
  groupBy: 'week',
  unpushedOnly: false,
  viewMode: 'list',
  busy: false,
};

function snapshot(overrides: Partial<ExtensionSnapshot> = {}): ExtensionSnapshot {
  return {
    nickname: 'CaseUser',
    preferredLanguage: 'python3',
    languages: [{ id: 'python3', label: 'Python 3', extension: 'py' }],
    repositories: [],
    issues: [],
    workspace: { kind: 'none', nestedStudyFolders: [] },
    workspaceTrusted: true,
    ...overrides,
  };
}

describe('shellModel', () => {
  it('reports whether any supported repository is open', () => {
    expect(hasRepositories(undefined)).toBe(false);
    expect(hasRepositories(snapshot())).toBe(false);
    expect(
      hasRepositories(
        snapshot({ repositories: [{ name: 'a', rootUri: 'file:///a', problems: [] }] }),
      ),
    ).toBe(true);
  });

  it('disables the current-problem tab until a solution is open', () => {
    expect(currentProblemTabModel(undefined).disabled).toBe(true);
    expect(
      currentProblemTabModel({
        rootUri: 'file:///study',
        slug: 'two-sum',
        solution: {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          gitStatus: 'pushed',
        },
        status: 'idle',
        runner: { status: 'checking' },
      }).disabled,
    ).toBe(false);
  });

  it('hides list chrome on the submission tab', () => {
    expect(listChromeHidden(ui)).toBe(false);
    expect(listChromeHidden({ ...ui, viewMode: 'submission' })).toBe(true);
  });
});
