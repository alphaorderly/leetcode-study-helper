import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { ExtensionSnapshot } from '../../../../src/shared/contracts';
import type { BatchSender } from '../../../../src/infrastructure/telemetry/usageQueue';

const mocks = vi.hoisted(() => ({
  globalValue: undefined as boolean | undefined,
  workspaceValue: undefined as boolean | undefined,
  hostEnabled: true,
  usageEnabled: true,
  envListeners: new Set<() => void>(),
  loggerListeners: new Set<() => void>(),
  configurationListeners: new Set<
    (event: { affectsConfiguration(key: string): boolean }) => void
  >(),
  settingUpdate: vi.fn<(key: string, enabled: boolean, target: unknown) => Promise<void>>(),
  prompt: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(),
  createLogger: vi.fn(),
  logUsage: vi.fn(),
  disposeLogger: vi.fn(),
  sender: undefined as vscode.TelemetrySender | undefined,
}));

vi.mock('vscode', () => ({
  version: '1.100.0',
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  ConfigurationTarget: { Global: 1 },
  EventEmitter: class<T> {
    private readonly listeners = new Set<(event: T) => void>();
    readonly event = (listener: (event: T) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(event: T) {
      for (const listener of this.listeners) listener(event);
    }
    dispose() {
      this.listeners.clear();
    }
  },
  env: {
    get isTelemetryEnabled() {
      return mocks.hostEnabled;
    },
    onDidChangeTelemetryEnabled: (listener: () => void) => {
      mocks.envListeners.add(listener);
      return { dispose: () => mocks.envListeners.delete(listener) };
    },
    createTelemetryLogger: (
      sender: vscode.TelemetrySender,
      options: vscode.TelemetryLoggerOptions,
    ) => {
      mocks.sender = sender;
      mocks.createLogger(sender, options);
      return {
        get isUsageEnabled() {
          return mocks.usageEnabled;
        },
        get isErrorsEnabled() {
          return true;
        },
        onDidChangeEnableStates: (listener: () => void) => {
          mocks.loggerListeners.add(listener);
          return { dispose: () => mocks.loggerListeners.delete(listener) };
        },
        logUsage: (name: string, data: Record<string, unknown>) => {
          mocks.logUsage(name, data);
          if (mocks.usageEnabled)
            sender.sendEventData(`alphaorderly.leetcode-study-helper/${name}`, data);
        },
        dispose: mocks.disposeLogger,
      };
    },
  },
  workspace: {
    getConfiguration: () => ({
      inspect: () => ({
        defaultValue: false,
        globalValue: mocks.globalValue,
        workspaceValue: mocks.workspaceValue,
      }),
      update: mocks.settingUpdate,
    }),
    onDidChangeConfiguration: (
      listener: (event: { affectsConfiguration(key: string): boolean }) => void,
    ) => {
      mocks.configurationListeners.add(listener);
      return { dispose: () => mocks.configurationListeners.delete(listener) };
    },
  },
  window: { showInformationMessage: mocks.prompt },
}));

import { TelemetryService } from '../../../../src/infrastructure/telemetry/telemetryService';

const INSTALLATION_KEY = 'telemetry.installationId.v1';
const PROMPT_KEY = 'telemetry.promptShown.v1';
const SETUP_KEY = 'telemetry.setupReady.v1';
const installationId = '11111111-1111-4111-8111-111111111111';
const extensionId = 'alphaorderly.leetcode-study-helper';
const services: TelemetryService[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function configurationChanged() {
  for (const listener of mocks.configurationListeners) {
    listener({ affectsConfiguration: (key) => key === 'leetcodeStudyHelper.telemetry.enabled' });
  }
}

function hostChanged() {
  for (const listener of mocks.loggerListeners) listener();
  for (const listener of mocks.envListeners) listener();
}

function createService(
  options: { consent?: boolean; mode?: number; storage?: Map<string, unknown> } = {},
) {
  mocks.globalValue = options.consent;
  const storage = options.storage ?? new Map<string, unknown>();
  const get = vi.fn((key: string, fallback?: unknown) =>
    storage.has(key) ? storage.get(key) : fallback,
  );
  const update = vi.fn(async (key: string, value: unknown) => {
    storage.set(key, value);
  });
  const uuid = vi.fn(() => installationId);
  const sender = vi.fn<BatchSender>().mockResolvedValue('accepted');
  const context = {
    extensionMode: options.mode ?? 1,
    extension: { id: extensionId, packageJSON: { version: '1.10.0' } },
    globalState: { get, update },
  } as unknown as vscode.ExtensionContext;
  const service = new TelemetryService(context, {
    sender,
    uuid,
    now: () => Date.now(),
    timestamp: () => new Date().toISOString(),
  });
  services.push(service);
  return { service, storage, get, update, uuid, sender, context };
}

function snapshot(nickname = 'CaseUser'): ExtensionSnapshot {
  return {
    nickname,
    preferredLanguage: 'python3',
    languages: [],
    workspaceTrusted: true,
    issues: [],
    repositories: [
      {
        name: 'private-repository',
        rootUri: 'file:///private-repository',
        problems: [
          {
            slug: 'two-sum',
            week: 1,
            difficulty: 'Easy',
            categories: [],
            blindCategories: [],
            completed: false,
            hasOtherSolutions: false,
            solutions: [],
          },
        ],
      },
    ],
  };
}

function completeOperation(service: TelemetryService) {
  service
    .begin('solution_open_finished', { problem_slug: 'two-sum', language: 'python3' })
    .finish({ outcome: 'completed' });
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z'));
  vi.clearAllMocks();
  mocks.globalValue = undefined;
  mocks.workspaceValue = undefined;
  mocks.hostEnabled = true;
  mocks.usageEnabled = true;
  mocks.sender = undefined;
  mocks.prompt.mockResolvedValue(undefined);
  mocks.settingUpdate.mockImplementation(async (_key, enabled) => {
    mocks.globalValue = enabled;
    configurationChanged();
  });
});

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  mocks.envListeners.clear();
  mocks.loggerListeners.clear();
  mocks.configurationListeners.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('TelemetryService consent and host policy', () => {
  it.each([
    { consent: false, host: true, usage: true, mode: 1, allowed: false },
    { consent: undefined, host: true, usage: true, mode: 1, allowed: false },
    { consent: true, host: false, usage: true, mode: 1, allowed: false },
    { consent: true, host: true, usage: false, mode: 1, allowed: false },
    { consent: true, host: true, usage: true, mode: 2, allowed: false },
    { consent: true, host: true, usage: true, mode: 3, allowed: false },
    { consent: true, host: true, usage: true, mode: 1, allowed: true },
  ])(
    'requires consent, both host gates, and production: $allowed ($consent/$host/$usage/$mode)',
    async (item) => {
      mocks.hostEnabled = item.host;
      mocks.usageEnabled = item.usage;
      const { service, sender, uuid } = createService({ consent: item.consent, mode: item.mode });
      await settle();
      expect(service.state.effectiveEnabled).toBe(item.allowed);
      completeOperation(service);
      await service.shutdown();
      expect(sender.mock.calls.length).toBe(item.allowed ? 1 : 0);
      expect(uuid.mock.calls.length).toBe(item.allowed ? 1 : 0);
      expect(mocks.createLogger).toHaveBeenCalledWith(expect.anything(), {
        ignoreBuiltInCommonProperties: true,
        ignoreUnhandledErrors: true,
      });
      expect(mocks.sender?.flush).toBeUndefined();
    },
  );

  it('ignores workspace opt-in and creates no identity before explicit user consent', async () => {
    mocks.workspaceValue = true;
    const { service, sender, get, uuid, storage } = createService();
    await settle();
    completeOperation(service);
    expect(get).not.toHaveBeenCalledWith(INSTALLATION_KEY);
    expect(uuid).not.toHaveBeenCalled();
    expect(storage.has(INSTALLATION_KEY)).toBe(false);
    expect(service.state).toEqual({ enabled: false, effectiveEnabled: false });
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });

  it('never retroactively records an operation begun before consent', async () => {
    const { service, sender } = createService({ consent: false });
    const operation = service.begin('solution_open_finished', { problem_slug: 'two-sum' });
    await service.setEnabled(true);
    operation.finish({ outcome: 'completed' });
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });

  it('reuses the persisted UUID across activations without generating a new identity', async () => {
    const storage = new Map<string, unknown>([[INSTALLATION_KEY, installationId]]);
    const first = createService({ consent: true, storage });
    await settle();
    completeOperation(first.service);
    await first.service.shutdown();
    const second = createService({ consent: true, storage });
    await settle();
    completeOperation(second.service);
    await second.service.shutdown();
    expect(first.uuid).not.toHaveBeenCalled();
    expect(second.uuid).not.toHaveBeenCalled();
    expect(first.sender.mock.calls[0]?.[0][0]?.distinct_id).toBe(installationId);
    expect(second.sender.mock.calls[0]?.[0][0]?.distinct_id).toBe(installationId);
  });

  it('replaces an invalid saved ID and never substitutes a machine identifier', async () => {
    const storage = new Map<string, unknown>([[INSTALLATION_KEY, 'private-machine-id']]);
    const { service, uuid, update, sender } = createService({ consent: true, storage });
    await settle();
    expect(uuid).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(INSTALLATION_KEY, installationId);
    completeOperation(service);
    await service.shutdown();
    expect(sender.mock.calls[0]?.[0][0]?.distinct_id).toBe(installationId);
  });

  it('refuses an invalid generated UUID without recording events', async () => {
    const { service, uuid, update, sender } = createService();
    uuid.mockReturnValueOnce('private-invalid-identifier');
    await service.setEnabled(true);
    expect(service.state.disabledReason).toBe('storage');
    expect(update).not.toHaveBeenCalledWith(INSTALLATION_KEY, expect.anything());
    completeOperation(service);
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });

  it('waits for identity persistence and stays disabled for the session when it fails', async () => {
    const { service, update, sender } = createService();
    const persistence = deferred<void>();
    update.mockImplementationOnce(() => persistence.promise);
    const enable = service.setEnabled(true);
    await settle();
    expect(service.state.effectiveEnabled).toBe(false);
    completeOperation(service);
    persistence.reject(new Error('storage failure'));
    await enable;
    expect(service.state).toEqual({
      enabled: true,
      effectiveEnabled: false,
      disabledReason: 'storage',
    });
    completeOperation(service);
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });

  it('does not accept a stale identity completion after consent was revoked', async () => {
    const { service, update, sender } = createService();
    const persistence = deferred<void>();
    update.mockImplementationOnce(() => persistence.promise);
    const enable = service.setEnabled(true);
    await settle();
    await service.setEnabled(false);
    persistence.resolve();
    await enable;
    completeOperation(service);
    expect(service.state.effectiveEnabled).toBe(false);
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });
});

describe('TelemetryService prompt and milestones', () => {
  it('shows initial consent with VS Code collection off without bypassing the host gate', async () => {
    mocks.hostEnabled = false;
    const { service, storage, uuid, sender } = createService();
    service.observe(snapshot(), { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(storage.has(PROMPT_KEY)).toBe(false);
    mocks.hostEnabled = true;
    hostChanged();
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(storage.has(PROMPT_KEY)).toBe(false);
    expect(uuid).not.toHaveBeenCalled();
    service.observe(snapshot(), { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(mocks.settingUpdate).toHaveBeenCalledExactlyOnceWith('telemetry.enabled', false, 1);
    expect(sender).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'does not prompt when a global choice already exists: %s',
    async (consent) => {
      const { service } = createService({ consent });
      service.observe(snapshot(), { viewOpened: true });
      await settle();
      expect(mocks.prompt).not.toHaveBeenCalled();
    },
  );

  it('keeps a dismissed prompt dismissed across activations', async () => {
    const first = createService();
    first.service.observe(snapshot(), { viewOpened: true });
    await settle();
    first.service.dispose();
    const second = createService({ consent: mocks.globalValue, storage: first.storage });
    second.service.observe(snapshot(), { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(first.uuid).not.toHaveBeenCalled();
    expect(second.uuid).not.toHaveBeenCalled();
  });

  it.each([
    { choice: undefined, enabled: false, writes: 1 },
    { choice: '수집하지 않음', enabled: false, writes: 1 },
    { choice: '동의', enabled: true, writes: 1 },
  ])(
    'only an explicit allow choice enables collection: $choice',
    async ({ choice, enabled, writes }) => {
      mocks.prompt.mockResolvedValueOnce(choice);
      const { service, sender, storage } = createService();
      service.observe(snapshot(), { viewOpened: true });
      await settle();
      expect(service.state.enabled).toBe(enabled);
      expect(mocks.settingUpdate).toHaveBeenCalledTimes(writes);
      expect(storage.has(PROMPT_KEY)).toBe(false);
      expect(mocks.settingUpdate).toHaveBeenCalledExactlyOnceWith('telemetry.enabled', enabled, 1);
      await service.shutdown();
      expect(sender.mock.calls.length).toBe(enabled ? 1 : 0);
    },
  );

  it('uses a short native modal title and puts the data policy in its detail', async () => {
    const { service } = createService();
    service.observe(snapshot(), { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledExactlyOnceWith(
      '사용 통계 수집에 동의하시겠습니까?',
      { modal: true, detail: expect.stringContaining('무작위 설치 식별자') },
      '동의',
      '수집하지 않음',
    );
    const options = mocks.prompt.mock.calls[0]?.[1] as { modal: boolean; detail: string };
    expect(options.detail).toContain('PostHog(US)');
    expect(options.detail).toContain('닉네임·코드·파일 경로·저장소 주소는 보내지 않습니다');
    expect(options.detail).toContain('VS Code 사용 통계가 꺼져 있으면 동의해도 전송하지 않습니다');
  });

  it('ignores a legacy prompt-shown marker when no global choice exists', async () => {
    const storage = new Map<string, unknown>([[PROMPT_KEY, true]]);
    const { service, uuid } = createService({ storage });
    service.observe(snapshot(), { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(mocks.globalValue).toBe(false);
    expect(uuid).not.toHaveBeenCalled();
  });

  it('asks again when the user removes a previously saved choice in the same session', async () => {
    const { service } = createService();
    service.observe(snapshot(), { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(mocks.globalValue).toBe(false);
    mocks.globalValue = undefined;
    configurationChanged();
    await settle();
    expect(mocks.prompt).toHaveBeenCalledTimes(2);
    expect(mocks.globalValue).toBe(false);
    service.observe(snapshot());
    service.observe(snapshot());
    await settle();
    expect(mocks.prompt).toHaveBeenCalledTimes(2);
  });

  it('prevents repeated and overlapping modals while a choice is pending', async () => {
    const firstChoice = deferred<string | undefined>();
    mocks.prompt.mockReturnValueOnce(firstChoice.promise);
    const { service, uuid } = createService();
    service.observe(snapshot(), { viewOpened: true });
    service.observe(snapshot());
    service.observe(snapshot(), { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    await service.setEnabled(false);
    mocks.globalValue = undefined;
    configurationChanged();
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    firstChoice.resolve('동의');
    await settle();
    expect(mocks.prompt).toHaveBeenCalledTimes(2);
    expect(mocks.globalValue).toBe(false);
    expect(uuid).not.toHaveBeenCalled();
  });

  it('does not repeat the modal in one session if storing the dismissed choice fails', async () => {
    mocks.settingUpdate.mockRejectedValueOnce(new Error('cannot save choice'));
    const { service, uuid, sender } = createService();
    service.observe(snapshot(), { viewOpened: true });
    await settle();
    service.observe(snapshot());
    service.observe(snapshot(), { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(service.state.enabled).toBe(false);
    expect(service.state.effectiveEnabled).toBe(false);
    expect(mocks.globalValue).toBeUndefined();
    expect(uuid).not.toHaveBeenCalled();
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });

  it('keeps checkbox preferences changeable while VS Code disables actual collection', async () => {
    mocks.hostEnabled = false;
    const { service, uuid, sender } = createService();
    service.observe(snapshot(), { viewOpened: true });
    await service.setEnabled(true);
    expect(service.state).toEqual({
      enabled: true,
      effectiveEnabled: false,
      disabledReason: 'vscode',
    });
    await service.setEnabled(false);
    expect(service.state).toEqual({ enabled: false, effectiveEnabled: false });
    expect(mocks.settingUpdate.mock.calls.map((call) => call[1])).toEqual([true, false]);
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(uuid).not.toHaveBeenCalled();
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });

  it('waits for an opened sidebar and shows consent even without a supported repository', async () => {
    const { service } = createService();
    service.observe(snapshot());
    await settle();
    expect(mocks.prompt).not.toHaveBeenCalled();
    service.observe({ ...snapshot(), repositories: [] }, { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    service.observe(snapshot());
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
  });

  it('saves consent in an unsupported workspace without recording study or setup events', async () => {
    mocks.prompt.mockResolvedValueOnce('동의');
    const { service, sender, storage } = createService();
    const unsupported = { ...snapshot(), repositories: [] };
    service.observe(unsupported, { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(mocks.settingUpdate).toHaveBeenCalledExactlyOnceWith('telemetry.enabled', true, 1);
    expect(service.state.enabled).toBe(true);
    service.observe(unsupported);
    await settle();
    expect(mocks.logUsage).not.toHaveBeenCalled();
    expect(storage.has(SETUP_KEY)).toBe(false);
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });

  it.each([2, 3])(
    'never shows unsupported-workspace consent in nonproduction mode %s',
    async (mode) => {
      const { service, sender, uuid } = createService({ mode });
      service.observe({ ...snapshot(), repositories: [] }, { viewOpened: true });
      await settle();
      expect(mocks.prompt).not.toHaveBeenCalled();
      expect(mocks.settingUpdate).not.toHaveBeenCalled();
      expect(uuid).not.toHaveBeenCalled();
      await service.shutdown();
      expect(sender).not.toHaveBeenCalled();
    },
  );

  it.each([
    { host: true, usage: true, mode: 2 },
    { host: true, usage: true, mode: 3 },
  ])('does not show a modal in development or test hosts ($mode)', async (options) => {
    mocks.hostEnabled = options.host;
    mocks.usageEnabled = options.usage;
    const { service, uuid } = createService({ mode: options.mode });
    service.observe(snapshot(), { viewOpened: true });
    await settle();
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.settingUpdate).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
  });

  it.each([
    { host: false, usage: true, choice: '동의', enabled: true },
    { host: false, usage: true, choice: '수집하지 않음', enabled: false },
    { host: false, usage: true, choice: undefined, enabled: false },
    { host: true, usage: false, choice: '동의', enabled: true },
    { host: true, usage: false, choice: '수집하지 않음', enabled: false },
    { host: true, usage: false, choice: undefined, enabled: false },
  ])(
    'saves modal choices while host usage is blocked and sends nothing ($host/$usage/$choice)',
    async (options) => {
      mocks.hostEnabled = options.host;
      mocks.usageEnabled = options.usage;
      mocks.prompt.mockResolvedValueOnce(options.choice);
      const { service, sender, uuid } = createService();
      service.observe(snapshot(), { viewOpened: true });
      await settle();
      expect(mocks.prompt).toHaveBeenCalledOnce();
      expect(mocks.settingUpdate).toHaveBeenCalledExactlyOnceWith(
        'telemetry.enabled',
        options.enabled,
        1,
      );
      expect(service.state.enabled).toBe(options.enabled);
      expect(service.state.effectiveEnabled).toBe(false);
      completeOperation(service);
      await service.shutdown();
      expect(uuid).not.toHaveBeenCalled();
      expect(sender).not.toHaveBeenCalled();
    },
  );

  it('records the latest setup snapshot after late opt-in and persists its one-time marker', async () => {
    const { service, storage, sender } = createService({ consent: false });
    service.observe(snapshot(''), { viewOpened: true });
    service.observe(snapshot());
    await service.setEnabled(true);
    service.observe(snapshot());
    service.observe(snapshot());
    await settle();
    expect(storage.get(SETUP_KEY)).toBe(true);
    await service.shutdown();
    expect(sender.mock.calls[0]?.[0].map((event) => event.event)).toEqual([
      'study_session_started',
      'setup_ready',
    ]);
    expect(sender.mock.calls[0]?.[0][0]?.properties.setup_ready).toBe(true);
    const next = createService({ consent: true, storage });
    await settle();
    next.service.observe(snapshot(), { viewOpened: true });
    await next.service.shutdown();
    expect(next.sender.mock.calls[0]?.[0].map((event) => event.event)).toEqual([
      'study_session_started',
    ]);
  });

  it('does not let an outstanding prompt override a newer explicit opt-out', async () => {
    const choice = deferred<string | undefined>();
    mocks.prompt.mockReturnValueOnce(choice.promise);
    const { service, sender } = createService();
    service.observe(snapshot(), { viewOpened: true });
    await settle();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    await service.setEnabled(false);
    choice.resolve('동의');
    await settle();
    expect(service.state.enabled).toBe(false);
    expect(mocks.settingUpdate).toHaveBeenCalledExactlyOnceWith('telemetry.enabled', false, 1);
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });
});

describe('TelemetryService generation changes and logger boundary', () => {
  it('discards queued and in-flight data on revocation and never revives older trackers', async () => {
    const { service, sender } = createService({ consent: true });
    await settle();
    const prior = service.begin('solution_open_finished', { problem_slug: 'two-sum' });
    const pending = deferred<'accepted'>();
    sender.mockReturnValueOnce(pending.promise);
    for (let index = 0; index < 20; index += 1) completeOperation(service);
    const previousSignal = sender.mock.calls[0]?.[1];
    expect(previousSignal?.aborted).toBe(false);
    completeOperation(service);
    await service.setEnabled(false);
    expect(previousSignal?.aborted).toBe(true);
    await service.setEnabled(true);
    prior.finish({ outcome: 'completed' });
    completeOperation(service);
    pending.resolve('accepted');
    await settle();
    await service.shutdown();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[1]?.[0]).toHaveLength(1);
  });

  it('serializes setting writes and honors the latest selection while writes are pending', async () => {
    const { service, sender } = createService({ consent: true });
    await settle();
    const firstWrite = deferred<void>();
    mocks.settingUpdate.mockImplementationOnce(async (_key, enabled) => {
      await firstWrite.promise;
      mocks.globalValue = enabled;
      configurationChanged();
    });
    const disable = service.setEnabled(false);
    const enable = service.setEnabled(true);
    completeOperation(service);
    await settle();
    expect(mocks.settingUpdate).toHaveBeenCalledTimes(1);
    expect(service.state).toEqual({ enabled: true, effectiveEnabled: false });
    firstWrite.resolve();
    await Promise.all([disable, enable]);
    expect(mocks.settingUpdate.mock.calls.map((call) => call[1])).toEqual([false, true]);
    completeOperation(service);
    await service.shutdown();
    expect(sender.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('honors a final opt-out even when an older opt-in write finishes first', async () => {
    const { service, sender, uuid } = createService({ consent: false });
    const firstWrite = deferred<void>();
    mocks.settingUpdate.mockImplementationOnce(async (_key, enabled) => {
      await firstWrite.promise;
      mocks.globalValue = enabled;
      configurationChanged();
    });
    const enable = service.setEnabled(true);
    const disable = service.setEnabled(false);
    await settle();
    expect(service.state).toEqual({ enabled: false, effectiveEnabled: false });
    firstWrite.resolve();
    await Promise.all([enable, disable]);
    completeOperation(service);
    expect(service.state.effectiveEnabled).toBe(false);
    expect(uuid).not.toHaveBeenCalled();
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });

  it('never revives an operation across a host-policy off/on cycle', async () => {
    const { service, sender, uuid } = createService({ consent: true });
    await settle();
    const old = service.begin('solution_open_finished', { problem_slug: 'two-sum' });
    mocks.hostEnabled = false;
    hostChanged();
    await settle();
    mocks.hostEnabled = true;
    hostChanged();
    await settle();
    old.finish({ outcome: 'completed' });
    completeOperation(service);
    await service.shutdown();
    expect(sender.mock.calls[0]?.[0]).toHaveLength(1);
    expect(uuid).toHaveBeenCalledOnce();
  });

  it.each([
    { consent: undefined, mode: 1 },
    { consent: true, mode: 2 },
    { consent: true, mode: 3 },
  ])('does not reach native fetch without opt-in production ($consent/$mode)', async (options) => {
    const fetch = vi.fn().mockRejectedValue(new Error('network forbidden in test'));
    vi.stubGlobal('fetch', fetch);
    const { context } = createService(options);
    const nativeService = new TelemetryService(context);
    services.push(nativeService);
    await settle();
    nativeService.observe(snapshot(), { viewOpened: true });
    completeOperation(nativeService);
    await nativeService.shutdown();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps collection off after opt-out persistence fails', async () => {
    const { service, sender } = createService({ consent: true });
    await settle();
    mocks.settingUpdate.mockRejectedValueOnce(new Error('cannot save preference'));
    await expect(service.setEnabled(false)).rejects.toThrow('cannot save preference');
    expect(service.state.effectiveEnabled).toBe(false);
    completeOperation(service);
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });

  it('clears the failed-opt-out safety latch only after a later explicit opt-in succeeds', async () => {
    const { service, sender } = createService({ consent: true });
    await settle();
    mocks.settingUpdate.mockRejectedValueOnce(new Error('cannot save preference'));
    await expect(service.setEnabled(false)).rejects.toThrow('cannot save preference');
    configurationChanged();
    await settle();
    expect(service.state.effectiveEnabled).toBe(false);
    completeOperation(service);
    await service.setEnabled(true);
    expect(service.state.effectiveEnabled).toBe(true);
    completeOperation(service);
    await service.shutdown();
    expect(sender.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('uses the exact logger prefix and drops unknown names and automatic identifiers', async () => {
    const { service, sender } = createService({ consent: true });
    await settle();
    const data = {
      outcome: 'completed',
      problem_slug: 'two-sum',
      nickname: 'PrivateUser',
      'common.vscodemachineid': 'private-machine',
      'common.vscodesessionid': 'private-session',
    };
    mocks.sender?.sendEventData('other.extension/solution_open_finished', data);
    mocks.sender?.sendEventData('solution_open_finished', data);
    mocks.sender?.sendEventData(`${extensionId}/unknown_event`, data);
    mocks.sender?.sendEventData(`${extensionId}/other/solution_open_finished`, data);
    expect(sender).not.toHaveBeenCalled();
    mocks.sender?.sendEventData(`${extensionId}/solution_open_finished`, data);
    completeOperation(service);
    await service.shutdown();
    expect(sender.mock.calls[0]?.[0]).toHaveLength(2);
    expect(sender.mock.calls[0]?.[0][0]?.event).toBe('solution_open_finished');
    expect(mocks.logUsage).toHaveBeenCalledWith('solution_open_finished', expect.anything());
    for (const event of sender.mock.calls[0]?.[0] ?? []) {
      expect(event.properties.$process_person_profile).toBe(false);
      expect(event.properties.$geoip_disable).toBe(true);
      expect(event.properties.environment).toBe('production');
      expect(JSON.stringify(event)).not.toMatch(/PrivateUser|private-machine|private-session/);
    }
  });

  it('drops queued work immediately when the host switches to errors-only and honors disposal', async () => {
    const { service, sender } = createService({ consent: true });
    await settle();
    completeOperation(service);
    mocks.usageEnabled = false;
    hostChanged();
    await settle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sender).not.toHaveBeenCalled();
    service.dispose();
    service.dispose();
    expect(mocks.disposeLogger).toHaveBeenCalledOnce();
    expect(mocks.envListeners.size).toBe(0);
    expect(mocks.loggerListeners.size).toBe(0);
    expect(mocks.configurationListeners.size).toBe(0);
    mocks.usageEnabled = true;
    hostChanged();
    completeOperation(service);
    await service.shutdown();
    expect(sender).not.toHaveBeenCalled();
  });
});
