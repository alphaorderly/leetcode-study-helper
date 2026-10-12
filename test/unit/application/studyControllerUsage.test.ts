import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySnapshot } from '../../../src/shared/contracts';
import type {
  CreateSolutionRequest,
  CreateSolutionResult,
} from '../../../src/infrastructure/workspace/solutionFileService';
import type { UsageRecorder } from '../../../src/shared/telemetry';
import { OTHER_SOLUTION_CONFIRM_LABEL } from '../../../src/domain/solutions/otherSolutions';

const mocks = vi.hoisted(() => ({
  create: vi.fn<(request: CreateSolutionRequest) => Promise<CreateSolutionResult>>(),
  openTextDocument: vi.fn(async (_uri: unknown) => {
    void _uri;
    return {};
  }),
  showTextDocument: vi.fn(async (_document: unknown, _options?: unknown) => {
    void _document;
    void _options;
  }),
  showInformationMessage: vi.fn(async (_message: string) => {
    void _message;
  }),
  showWarningMessage: vi.fn<() => Promise<string | undefined>>(),
  openExternal: vi.fn(async (_uri: unknown) => {
    void _uri;
    return true;
  }),
  findOtherSolution: vi.fn(),
  refreshProblem: vi.fn(async (_rootUri: string, _slug: string, _status: boolean) => {
    void _rootUri;
    void _slug;
    void _status;
  }),
  repositories: [] as RepositorySnapshot[],
}));
vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  },
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  env: { openExternal: mocks.openExternal },
  window: {
    showTextDocument: mocks.showTextDocument,
    showInformationMessage: mocks.showInformationMessage,
    showWarningMessage: mocks.showWarningMessage,
  },
  workspace: {
    isTrusted: true,
    openTextDocument: mocks.openTextDocument,
    getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidGrantWorkspaceTrust: () => ({ dispose() {} }),
  },
}));
vi.mock('../../../src/infrastructure/git/gitStatusService', () => ({
  GitStatusService: class {
    dispose() {}
  },
}));
vi.mock('../../../src/application/sessions/repositoryRefreshSession', () => ({
  RepositoryRefreshSession: class {
    onDidChange = () => ({ dispose() {} });
    refresh = async () => ({ repositories: mocks.repositories, issues: [] });
    refreshProblem = mocks.refreshProblem;
    dispose() {}
  },
}));
vi.mock('../../../src/application/sessions/currentProblemSession', () => ({
  CurrentProblemSession: class {
    currentSnapshot = undefined;
    onDidChange = () => ({ dispose() {} });
    setRepositories() {}
    dispose() {}
  },
}));
vi.mock('../../../src/infrastructure/workspace/repositoryService', () => ({
  StudyRepositoryService: class {
    findOtherSolution = mocks.findOtherSolution;
  },
}));
vi.mock('../../../src/infrastructure/workspace/solutionFileService', () => ({
  SolutionFileService: class {
    create = mocks.create;
  },
}));

import { StudyController } from '../../../src/application/studyController';

const solutionUri = 'file:///study/two-sum/PrivateUser.py';
const createdUri = {
  toString: () => solutionUri,
  path: '/study/two-sum/PrivateUser.py',
};

async function setup() {
  const operation = { markResult: vi.fn(), finish: vi.fn() };
  const usage = { begin: vi.fn<UsageRecorder['begin']>(() => operation) };
  const controller = new StudyController(
    {} as never,
    {
      get: () => undefined,
      update: async () => {},
    },
    usage,
  );
  await controller.getState();
  return { controller, usage, operation };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.repositories = [
    {
      name: 'private-repository',
      rootUri: 'file:///study',
      problems: [
        {
          slug: 'two-sum',
          week: 1,
          solutionUrl: 'https://www.algodale.com/problems/two-sum/',
          difficulty: 'Easy',
          categories: [],
          blindCategories: [],
          completed: true,
          hasOtherSolutions: true,
          solutions: [{ name: 'PrivateUser.py', uri: solutionUri, gitStatus: 'unknown' }],
        },
      ],
    },
  ];
  mocks.create.mockResolvedValue({ status: 'created', uri: createdUri as never });
  mocks.findOtherSolution.mockResolvedValue(createdUri);
  mocks.showWarningMessage.mockResolvedValue(OTHER_SOLUTION_CONFIRM_LABEL);
  mocks.openExternal.mockResolvedValue(true);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('StudyController usage outcomes', () => {
  it('records an editor-open result without a nickname, repository name, URI, or path', async () => {
    const { controller, usage, operation } = await setup();
    try {
      expect(usage.begin).not.toHaveBeenCalled();
      await controller.openSolution(solutionUri);
      expect(usage.begin).toHaveBeenCalledExactlyOnceWith('solution_open_finished', {
        problem_slug: 'two-sum',
        study_week: 1,
        language: 'python3',
      });
      expect(operation.finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'completed' });
      expect(JSON.stringify(usage.begin.mock.calls)).not.toMatch(
        /PrivateUser|private-repository|file:\/\//,
      );
    } finally {
      controller.dispose();
    }
  });

  it.each(['editor', 'refresh'] as const)(
    'preserves a created-file receipt when %s fails',
    async (stage) => {
      const { controller, usage, operation } = await setup();
      const failure = new Error('private path /study/PrivateUser.py');
      if (stage === 'editor') mocks.showTextDocument.mockRejectedValueOnce(failure);
      else mocks.refreshProblem.mockRejectedValueOnce(failure);
      try {
        await expect(controller.createSolution('file:///study', 'two-sum')).rejects.toBe(failure);
        expect(usage.begin).toHaveBeenCalledExactlyOnceWith('solution_create_finished', {
          problem_slug: 'two-sum',
          study_week: 1,
          language: 'python3',
        });
        expect(operation.markResult).toHaveBeenCalledExactlyOnceWith({
          outcome: 'completed',
          create_result: 'created',
        });
        expect(operation.finish).toHaveBeenCalledExactlyOnceWith({
          outcome: 'error',
          error_code: 'operation_failed',
          failure_stage: stage,
        });
        expect(operation.markResult.mock.invocationCallOrder[0]).toBeLessThan(
          operation.finish.mock.invocationCallOrder[0]!,
        );
      } finally {
        controller.dispose();
      }
    },
  );

  it('distinguishes existing files from cancelled creation without changing URI returns', async () => {
    const { controller, operation } = await setup();
    mocks.create.mockResolvedValueOnce({ status: 'exists', uri: createdUri as never });
    try {
      await expect(controller.createSolution('file:///study', 'two-sum')).resolves.toBe(
        solutionUri,
      );
      expect(operation.markResult).toHaveBeenCalledWith({
        outcome: 'completed',
        create_result: 'exists',
      });
      expect(operation.markResult.mock.invocationCallOrder[0]).toBeGreaterThan(
        mocks.showTextDocument.mock.invocationCallOrder[0]!,
      );
      operation.markResult.mockClear();
      operation.finish.mockClear();
      mocks.openTextDocument.mockClear();
      mocks.create.mockResolvedValueOnce({ status: 'cancelled' });
      await expect(controller.createSolution('file:///study', 'two-sum')).resolves.toBeUndefined();
      expect(operation.markResult).toHaveBeenCalledExactlyOnceWith({ outcome: 'cancelled' });
      expect(operation.finish).toHaveBeenCalledOnce();
      expect(mocks.openTextDocument).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it.each(['openTextDocument', 'showTextDocument'] as const)(
    'records an existing-file %s failure as an error without a successful receipt',
    async (editorAction) => {
      const { controller, operation } = await setup();
      mocks.create.mockResolvedValueOnce({ status: 'exists', uri: createdUri as never });
      const failure = new Error('private editor failure');
      mocks[editorAction].mockRejectedValueOnce(failure);
      try {
        await expect(controller.createSolution('file:///study', 'two-sum')).rejects.toBe(failure);
        expect(operation.markResult).toHaveBeenCalledExactlyOnceWith({
          outcome: 'error',
          create_result: 'exists',
        });
        expect(operation.finish).toHaveBeenCalledExactlyOnceWith({
          outcome: 'error',
          error_code: 'operation_failed',
          failure_stage: 'editor',
        });
        expect(mocks.refreshProblem).not.toHaveBeenCalled();
      } finally {
        controller.dispose();
      }
    },
  );

  it('separates absent references, cancelled consent, and actual reference opens', async () => {
    const { controller, usage, operation } = await setup();
    try {
      mocks.findOtherSolution.mockResolvedValueOnce(undefined);
      await expect(
        controller.openOtherSolution('file:///study', 'two-sum'),
      ).resolves.toBeUndefined();
      expect(operation.markResult).toHaveBeenLastCalledWith({ outcome: 'noop' });
      mocks.showWarningMessage.mockResolvedValueOnce(undefined);
      await expect(
        controller.openOtherSolution('file:///study', 'two-sum'),
      ).resolves.toBeUndefined();
      expect(operation.markResult).toHaveBeenLastCalledWith({ outcome: 'cancelled' });
      await expect(controller.openOtherSolution('file:///study', 'two-sum', false)).resolves.toBe(
        solutionUri,
      );
      expect(mocks.showTextDocument).toHaveBeenCalledOnce();
      expect(usage.begin).toHaveBeenCalledTimes(3);
      expect(operation.finish).toHaveBeenCalledTimes(3);
      for (const [, properties] of usage.begin.mock.calls) {
        expect(properties).toEqual({
          problem_slug: 'two-sum',
          study_week: 1,
          reference_kind: 'other_solution',
        });
      }
    } finally {
      controller.dispose();
    }
  });

  it('does not count an answer cancellation or a rejected browser open as completion', async () => {
    const { controller, usage, operation } = await setup();
    try {
      mocks.showWarningMessage.mockResolvedValueOnce(undefined);
      await expect(controller.openAnswer('file:///study', 'two-sum')).resolves.toBe(false);
      expect(usage.begin).toHaveBeenLastCalledWith('reference_open_finished', {
        problem_slug: 'two-sum',
        study_week: 1,
        reference_kind: 'answer',
      });
      expect(operation.markResult).toHaveBeenCalledExactlyOnceWith({ outcome: 'cancelled' });
      expect(mocks.openExternal).not.toHaveBeenCalled();
      operation.markResult.mockClear();
      operation.finish.mockClear();
      mocks.openExternal.mockResolvedValueOnce(false);
      await expect(controller.openProblem('two-sum')).rejects.toThrow('페이지를 열지 못했습니다');
      expect(usage.begin).toHaveBeenLastCalledWith('reference_open_finished', {
        problem_slug: 'two-sum',
        study_week: 1,
        reference_kind: 'problem',
      });
      expect(operation.markResult).not.toHaveBeenCalled();
      expect(operation.finish).toHaveBeenCalledExactlyOnceWith({
        outcome: 'error',
        error_code: 'operation_failed',
        failure_stage: 'editor',
      });
    } finally {
      controller.dispose();
    }
  });

  it('records validation and file-write failures without manufacturing a creation receipt', async () => {
    const { controller, usage, operation } = await setup();
    try {
      await expect(
        controller.createSolution('file:///study', 'private-input-slug'),
      ).rejects.toThrow('현재 워크스페이스');
      expect(mocks.create).not.toHaveBeenCalled();
      expect(usage.begin).toHaveBeenLastCalledWith('solution_create_finished', {
        problem_slug: undefined,
        study_week: undefined,
        language: 'python3',
      });
      expect(operation.finish).toHaveBeenCalledExactlyOnceWith({
        outcome: 'error',
        error_code: 'operation_failed',
        failure_stage: 'validation',
      });
      operation.finish.mockClear();
      mocks.create.mockRejectedValueOnce(new Error('private write failure'));
      await expect(controller.createSolution('file:///study', 'two-sum')).rejects.toThrow(
        'private write failure',
      );
      expect(operation.markResult).not.toHaveBeenCalled();
      expect(operation.finish).toHaveBeenCalledExactlyOnceWith({
        outcome: 'error',
        error_code: 'operation_failed',
        failure_stage: 'execute',
      });
    } finally {
      controller.dispose();
    }
  });

  it('keeps telemetry-port failures from changing a successful operation', async () => {
    const { controller, usage } = await setup();
    usage.begin.mockImplementationOnce(() => {
      throw new Error('telemetry failure');
    });
    try {
      await expect(controller.openSolution(solutionUri)).resolves.toBeUndefined();
      usage.begin.mockReturnValueOnce({
        markResult: () => {
          throw new Error('telemetry failure');
        },
        finish: () => {
          throw new Error('telemetry failure');
        },
      });
      await expect(controller.createSolution('file:///study', 'two-sum')).resolves.toBe(
        solutionUri,
      );
    } finally {
      controller.dispose();
    }
  });
});
