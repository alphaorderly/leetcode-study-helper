import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparationRecord } from '../../../../src/infrastructure/git/submission/preparationWorkflow';
import type { GitOperationResult } from '../../../../src/infrastructure/git/submission/operationObservation';
import { PreparationService } from '../../../../src/infrastructure/git/submission/preparationService';

const mocks = vi.hoisted(() => ({
  saveAll: vi.fn(),
  showQuickPick: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  workflow: {
    exclusive: vi.fn(),
    read: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    cleanup: vi.fn(),
    openExistingTarget: vi.fn(),
    preview: vi.fn(),
    start: vi.fn(),
    records: vi.fn(),
    conflicts: vi.fn(),
    git: { paths: vi.fn() },
  },
}));
vi.mock('vscode', () => ({
  workspace: { isTrusted: true, saveAll: mocks.saveAll },
  window: {
    showQuickPick: mocks.showQuickPick,
    showInformationMessage: mocks.showInformationMessage,
    showWarningMessage: mocks.showWarningMessage,
  },
}));
vi.mock('../../../../src/infrastructure/git/submission/preparationWorkflow', () => ({
  PreparationWorkflow: vi.fn(function () {
    return mocks.workflow;
  }),
}));

/** 실제 journal에는 포함되지만 관찰 결과에는 없어야 하는 필드도 가진 준비 기록입니다. */
function record(phase: PreparationRecord['phase'] = 'push'): PreparationRecord {
  return {
    version: 1,
    createdAt: 0,
    id: 'private-journal-id',
    phase,
    sourceBranch: 'week-01',
    sourceHead: 'private-commit-hash',
    base: 'private-base',
    snapshot: 'private-snapshot',
    fingerprint: 'private-fingerprint',
    dirty: false,
    files: ['two-sum/PrivateUser.py'],
    selected: [],
    targetWeek: 2,
    applied: [],
    pushed: false,
    extras: [],
    originUrl: 'https://github.com/PrivateUser/private-repository',
  };
}

/** Git 워크플로는 메모리 대체물을 사용하여 네트워크와 파일 쓰기를 실행하지 않습니다. */
function setup() {
  const root = { fsPath: '/private-study', toString: () => 'file:///private-study' };
  const repository = { rootUri: root, state: { remotes: [] }, fetch: vi.fn(async () => {}) };
  const service = new PreparationService(
    {
      requireRepository: vi.fn(async () => repository),
      executable: vi.fn(async () => 'git'),
    } as never,
    {} as never,
  );
  vi.spyOn(service, 'currentPullRequest').mockResolvedValue({
    number: 1,
    merged_at: '2026-10-12',
    head: { sha: 'private-head', ref: 'week-01' },
  } as never);
  const results: GitOperationResult[] = [];
  return {
    service,
    root: root as never,
    results,
    observer: (result: GitOperationResult) => results.push(result),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveAll.mockResolvedValue(true);
  mocks.showQuickPick.mockResolvedValue(undefined);
  mocks.showInformationMessage.mockResolvedValue(undefined);
  mocks.showWarningMessage.mockResolvedValue(undefined);
  mocks.workflow.exclusive.mockImplementation(async (action: () => Promise<unknown>) => action());
  mocks.workflow.read.mockResolvedValue(record());
  mocks.workflow.resume.mockResolvedValue(record('done'));
  mocks.workflow.cancel.mockResolvedValue(record('cancelled'));
  mocks.workflow.openExistingTarget.mockResolvedValue(record('done'));
  mocks.workflow.cleanup.mockResolvedValue(undefined);
  mocks.workflow.preview.mockResolvedValue({
    branch: 'week-01',
    files: [],
    extraCommitCount: 0,
    extraCommits: [],
  });
  mocks.workflow.start.mockResolvedValue(record('preserve'));
  mocks.workflow.records.mockResolvedValue([record()]);
  mocks.workflow.conflicts.mockResolvedValue([]);
  mocks.workflow.git.paths.mockResolvedValue(['sample.py']);
});

describe('PreparationService observation', () => {
  it('reports save cancellation without starting a journal', async () => {
    mocks.saveAll.mockResolvedValueOnce(false);
    const { service, root, results, observer } = setup();
    await expect(service.prepare(root, [], undefined, observer)).resolves.toEqual({
      outcome: 'cancelled',
    });
    expect(results).toEqual([{ outcome: 'cancelled' }]);
    expect(mocks.workflow.start).not.toHaveBeenCalled();
  });

  it('reports final confirmation dismissal without starting work', async () => {
    const { service, root, results, observer } = setup();
    await service.prepare(root, [], undefined, observer);
    expect(results).toEqual([{ outcome: 'cancelled', sourceWeek: 1, targetWeek: undefined }]);
    expect(mocks.workflow.start).not.toHaveBeenCalled();
  });

  it('reports completed preparation before lock cleanup can fail', async () => {
    mocks.showInformationMessage.mockResolvedValueOnce('보존하고 다음 주차 준비');
    const failure = new Error('private lock removal failure');
    mocks.workflow.exclusive.mockImplementationOnce(async (action: () => Promise<unknown>) => {
      await action();
      throw failure;
    });
    const { service, root, results, observer } = setup();
    await expect(service.prepare(root, [], undefined, observer)).rejects.toBe(failure);
    expect(results).toEqual([
      { outcome: 'completed', phase: 'done', sourceWeek: 1, targetWeek: 2, problemCount: 0 },
    ]);
    expect(JSON.stringify(results)).not.toContain('private');
  });

  it.each(['done', 'cancelled'] as const)('reports continue on %s as noop', async (phase) => {
    mocks.workflow.read.mockResolvedValueOnce(record(phase));
    const { service, root, results, observer } = setup();
    await service.action(root, 'id', 'continue', observer);
    expect(results[0]).toMatchObject({ outcome: 'noop', phase });
    expect(mocks.workflow.resume).not.toHaveBeenCalled();
  });

  it('reports successful original restoration as completed with cancelled phase', async () => {
    mocks.showWarningMessage.mockResolvedValueOnce('원본 복원');
    const { service, root, results, observer } = setup();
    await service.action(root, 'id', 'cancel', observer);
    expect(results[0]).toMatchObject({ outcome: 'completed', phase: 'cancelled' });
  });

  it('distinguishes a dismissed restore dialog from a restored original', async () => {
    const { service, root, results, observer } = setup();
    await service.action(root, 'id', 'cancel', observer);
    expect(results[0]).toMatchObject({ outcome: 'cancelled', phase: 'push' });
    expect(mocks.workflow.cancel).not.toHaveBeenCalled();
  });

  it('reports an existing-week open as a completed action without exposing journal data', async () => {
    const { service, root, results, observer } = setup();
    await service.action(root, 'id', 'existingWeek', observer);
    expect(results).toEqual([
      { outcome: 'completed', phase: 'done', sourceWeek: 1, targetWeek: 2, problemCount: 0 },
    ]);
    expect(JSON.stringify(results)).not.toContain('PrivateUser');
  });

  it('keeps the pre-deletion phase after successful cleanup', async () => {
    mocks.workflow.read.mockResolvedValueOnce(record('cancelled'));
    mocks.showWarningMessage.mockResolvedValueOnce('기록 정리');
    const { service, root, results, observer } = setup();
    await service.action(root, 'id', 'cleanup', observer);
    expect(results[0]).toMatchObject({ outcome: 'completed', phase: 'cancelled' });
    expect(mocks.workflow.read).toHaveBeenCalledOnce();
  });

  it('reports dismissed shelf picker and empty conflict list truthfully', async () => {
    const { service, root, results, observer } = setup();
    await service.action(root, 'id', 'shelf', observer);
    await service.action(root, 'id', 'conflicts', observer);
    expect(results.map(({ outcome }) => outcome)).toEqual(['cancelled', 'noop']);
  });

  it('reports a saved recovery phase while rethrowing the original execution error', async () => {
    const failure = new Error('private filename conflict');
    mocks.workflow.resume.mockRejectedValueOnce(failure);
    mocks.workflow.read
      .mockResolvedValueOnce(record('push'))
      .mockResolvedValueOnce(record('applying'));
    const { service, root, results, observer } = setup();
    await expect(service.action(root, 'id', 'continue', observer)).rejects.toBe(failure);
    expect(results).toEqual([
      {
        outcome: 'awaiting_recovery',
        phase: 'applying',
        sourceWeek: 1,
        targetWeek: 2,
        problemCount: 0,
      },
    ]);
    expect(JSON.stringify(results)).not.toContain('private');
  });

  it('preserves the original error if diagnostic journal reading also fails', async () => {
    const failure = new Error('execution failed');
    mocks.workflow.resume.mockRejectedValueOnce(failure);
    mocks.workflow.read
      .mockResolvedValueOnce(record())
      .mockRejectedValueOnce(new Error('journal failed'));
    const { service, root, results, observer } = setup();
    await expect(service.action(root, 'id', 'continue', observer)).rejects.toBe(failure);
    expect(results).toEqual([{ outcome: 'error' }]);
  });

  it('ignores observer failure after successful recovery', async () => {
    const { service, root } = setup();
    await expect(
      service.action(root, 'id', 'continue', () => {
        throw new Error('observer failure');
      }),
    ).resolves.toMatchObject({ outcome: 'completed', phase: 'done' });
  });

  it('reports lock acquisition failure as error even when an existing record is pending', async () => {
    const failure = new Error('another process holds the lock');
    mocks.workflow.exclusive.mockRejectedValueOnce(failure);
    const { service, root, results, observer } = setup();
    await expect(service.action(root, 'id', 'continue', observer)).rejects.toBe(failure);
    expect(results).toEqual([{ outcome: 'error' }]);
    expect(mocks.workflow.read).not.toHaveBeenCalled();
    expect(mocks.workflow.resume).not.toHaveBeenCalled();
  });

  it('reports cancellation metadata from the record selected in the shelf picker', async () => {
    const selected = {
      ...record('done'),
      id: 'another-record',
      sourceBranch: 'week-03',
      targetWeek: 4,
    };
    mocks.workflow.records.mockResolvedValueOnce([record(), selected]);
    mocks.showQuickPick
      .mockResolvedValueOnce({ record: selected })
      .mockResolvedValueOnce(undefined);
    const { service, root, results, observer } = setup();
    await service.action(root, 'initial-record', 'shelf', observer);
    expect(results).toEqual([
      { outcome: 'cancelled', phase: 'done', sourceWeek: 3, targetWeek: 4, problemCount: 0 },
    ]);
  });

  it('reports completed comparison using the selected shelf record metadata', async () => {
    const selected = {
      ...record('cancelled'),
      id: 'another-record',
      sourceBranch: 'week-03',
      targetWeek: 4,
    };
    mocks.workflow.records.mockResolvedValueOnce([record(), selected]);
    mocks.showQuickPick
      .mockResolvedValueOnce({ record: selected })
      .mockResolvedValueOnce({ ref: selected.snapshot, base: selected.base })
      .mockResolvedValueOnce('sample.py')
      .mockResolvedValueOnce('변경 비교');
    const { service, root, results, observer } = setup();
    const diff = vi
      .spyOn(service as unknown as { diff(): Promise<void> }, 'diff')
      .mockResolvedValueOnce(undefined);
    await service.action(root, 'initial-record', 'shelf', observer);
    expect(results).toEqual([
      { outcome: 'completed', phase: 'cancelled', sourceWeek: 3, targetWeek: 4, problemCount: 0 },
    ]);
    expect(diff).toHaveBeenCalledOnce();
    diff.mockRestore();
  });

  it('diagnoses shelf failure from the selected record rather than the initial pending record', async () => {
    const selected = {
      ...record('done'),
      id: 'selected-record',
      sourceBranch: 'week-03',
      targetWeek: 4,
    };
    mocks.workflow.records.mockResolvedValueOnce([record(), selected]);
    mocks.workflow.read.mockResolvedValueOnce(record()).mockResolvedValueOnce(selected);
    mocks.showQuickPick
      .mockResolvedValueOnce({ record: selected })
      .mockResolvedValueOnce({ ref: selected.snapshot, base: selected.base })
      .mockResolvedValueOnce('sample.py')
      .mockResolvedValueOnce('현재 브랜치에 복원');
    const { service, root, results, observer } = setup();
    await expect(service.action(root, 'initial-record', 'shelf', observer)).rejects.toThrow(
      '진행 중인 준비',
    );
    expect(mocks.workflow.read).toHaveBeenNthCalledWith(2, 'selected-record');
    expect(results).toEqual([
      { outcome: 'error', phase: 'done', sourceWeek: 3, targetWeek: 4, problemCount: 0 },
    ]);
  });

  it.each([
    { selected: ['valid-anagram/PrivateUser.py', 'valid-anagram/PrivateUser.js'], count: 1 },
    {
      selected: [
        'valid-anagram/PrivateUser.py',
        'climbing-stairs/PrivateUser.py',
        'unknown-task/PrivateUser.py',
        'notes/private.md',
        'two-sum',
      ],
      count: 2,
    },
  ])(
    'counts $count unique official selected problems without exposing their paths',
    async ({ selected, count }) => {
      mocks.workflow.resume.mockResolvedValueOnce({ ...record('done'), selected });
      const { service, root, results, observer } = setup();
      await service.action(root, 'id', 'continue', observer);
      expect(results[0]).toMatchObject({ outcome: 'completed', problemCount: count });
      expect(JSON.stringify(results)).not.toContain('PrivateUser');
      expect(JSON.stringify(results)).not.toContain('unknown-task');
    },
  );
});
