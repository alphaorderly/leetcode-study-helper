import { afterEach, describe, expect, it, vi } from 'vitest';

function noopEvent(): () => { dispose(): void } {
  return () => ({ dispose(): void {} });
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock('vscode');
  vi.doUnmock('../../../src/application/sessions/currentProblemSession.js');
  vi.doUnmock('../../../src/infrastructure/git/gitStatusService.js');
  vi.doUnmock('../../../src/infrastructure/workspace/repositoryService.js');
  vi.doUnmock('../../../src/infrastructure/workspace/solutionFileService.js');
});

/** 하위 저장소 후보가 있는 워크스페이스에서 온보딩 동작에 필요한 VS Code API만 목으로 구성합니다. */
async function createController(options: { login?: string; cloneFails?: boolean } = {}) {
  const executeCommand = vi.fn(async (command: string) => {
    if (command === 'git.clone' && options.cloneFails) {
      throw new Error('command not found');
    }
    return undefined;
  });
  const openExternal = vi.fn(async (uri: { toString(): string }) => {
    void uri;
    return true;
  });
  const getSession = vi.fn(async () =>
    options.login === undefined ? undefined : { account: { label: options.login } },
  );
  class TestEventEmitter {
    readonly event = noopEvent();
    fire(): void {}
    dispose(): void {}
  }
  vi.doMock('vscode', () => ({
    EventEmitter: TestEventEmitter,
    Uri: { parse: (value: string) => ({ toString: () => value, value }) },
    env: { openExternal },
    commands: { executeCommand },
    authentication: { getSession },
    window: {},
    workspace: {
      isTrusted: true,
      workspaceFolders: [],
      getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback }),
      onDidChangeWorkspaceFolders: noopEvent(),
      onDidChangeConfiguration: noopEvent(),
      onDidGrantWorkspaceTrust: noopEvent(),
    },
  }));
  vi.doMock('../../../src/application/sessions/currentProblemSession.js', () => ({
    CurrentProblemSession: class {
      readonly onDidChange = noopEvent();
      readonly currentSnapshot = undefined;
      setRepositories(): void {}
      dispose(): void {}
    },
  }));
  vi.doMock('../../../src/infrastructure/git/gitStatusService.js', () => ({
    GitStatusService: class {
      readonly onDidChange = noopEvent();
      readonly getStatuses = vi.fn(async () => ({ statuses: new Map() }));
      dispose(): void {}
    },
  }));
  const scan = vi.fn(async () => ({
    repositories: [],
    issues: [],
    workspace: {
      kind: 'nested' as const,
      nestedStudyFolders: [{ name: 'leetcode-study', uri: 'file:///dev/leetcode-study' }],
    },
  }));
  vi.doMock('../../../src/infrastructure/workspace/repositoryService.js', () => ({
    StudyRepositoryService: class {
      scan = scan;
    },
  }));
  vi.doMock('../../../src/infrastructure/workspace/solutionFileService.js', () => ({
    SolutionFileService: class {},
  }));
  const { StudyController } = await import('../../../src/application/studyController.js');
  const controller = new StudyController({} as never, {
    get: () => undefined,
    update: async () => {},
  });
  await controller.getState();
  return { controller, executeCommand, openExternal, getSession, scan };
}

describe('StudyController onboarding actions', () => {
  it('publishes the workspace classification in the snapshot', async () => {
    const { controller } = await createController();
    expect(controller.currentSnapshot.workspace.kind).toBe('nested');
    controller.dispose();
  });

  it('opens the folder picker', async () => {
    const { controller, executeCommand } = await createController();
    await controller.handleOnboardingAction('openFolder');
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.files.openFolder');
    controller.dispose();
  });

  it('opens only the fixed official fork page, ignoring any target', async () => {
    const { controller, openExternal } = await createController();
    await controller.handleOnboardingAction('openForkPage', 'https://evil.example/');
    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal.mock.calls[0]![0].toString()).toBe(
      'https://github.com/DaleStudy/leetcode-study/fork',
    );
    controller.dispose();
  });

  it('opens a nested folder only when the snapshot offered it', async () => {
    const { controller, executeCommand } = await createController();
    await controller.handleOnboardingAction('openNestedFolder', 'file:///dev/leetcode-study');
    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.openFolder',
      expect.objectContaining({ value: 'file:///dev/leetcode-study' }),
    );
    executeCommand.mockClear();

    await expect(
      controller.handleOnboardingAction('openNestedFolder', 'file:///etc'),
    ).rejects.toThrow('열 수 있는 스터디 폴더가 아닙니다');
    await expect(controller.handleOnboardingAction('openNestedFolder')).rejects.toThrow();
    expect(executeCommand).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('pre-fills the clone URL from an existing GitHub session without prompting', async () => {
    const { controller, executeCommand, getSession } = await createController({
      login: 'octo-cat',
    });
    await controller.handleOnboardingAction('cloneRepository');
    expect(getSession).toHaveBeenCalledWith('github', ['public_repo'], {
      createIfNone: false,
      silent: true,
    });
    expect(executeCommand).toHaveBeenCalledWith(
      'git.clone',
      'https://github.com/octo-cat/leetcode-study.git',
    );
    controller.dispose();
  });

  it.each([[undefined], ['bad/name'], ['a b']])(
    'lets the user type the URL when the session gives %s',
    async (login) => {
      const { controller, executeCommand } = await createController({ login });
      await controller.handleOnboardingAction('cloneRepository');
      expect(executeCommand).toHaveBeenCalledWith('git.clone');
      expect(executeCommand.mock.calls[0]).toHaveLength(1);
      controller.dispose();
    },
  );

  it('keeps the original error and explains the likely causes when the clone command fails', async () => {
    const { controller } = await createController({ cloneFails: true });
    const failure = controller.handleOnboardingAction('cloneRepository');
    await expect(failure).rejects.toThrow('command not found');
    await expect(failure).rejects.toThrow('git.enabled');
    await expect(failure).rejects.toThrow('제한 모드');
    await expect(failure).rejects.toThrow('git clone');
    await expect(failure).rejects.toHaveProperty('cause');
    controller.dispose();
  });

  it('rescans the workspace on recheck', async () => {
    const { controller, scan } = await createController();
    scan.mockClear();
    await controller.handleOnboardingAction('recheck');
    expect(scan).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
