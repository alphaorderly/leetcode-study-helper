import { describe, expect, it } from 'vitest';
import type { ExtensionSnapshot } from '../../src/shared/contracts';
import {
  currentProblemTabModel,
  listChromeHidden,
  shellNotices,
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
    workspaceTrusted: true,
    ...overrides,
  };
}

describe('shellModel', () => {
  it('asks for nickname and a supported workspace when both are missing', () => {
    const notices = shellNotices(snapshot({ nickname: '' }));
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain('닉네임');
    expect(notices[1]).toContain('problem-categories.json');
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
