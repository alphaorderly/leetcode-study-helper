import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

interface FakeTelemetry {
  context: vscode.ExtensionContext;
  shutdown: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  resolveShutdown(): void;
}

const mocks = vi.hoisted(() => ({
  instances: [] as FakeTelemetry[],
  controllerConstructor: vi.fn(),
  providerConstructor: vi.fn(),
  controllerDispose: vi.fn(),
  providerDispose: vi.fn(),
  registerCommand: vi.fn(),
  registerProvider: vi.fn(),
}));

vi.mock('vscode', () => ({
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  window: { registerWebviewViewProvider: mocks.registerProvider },
  commands: { registerCommand: mocks.registerCommand, executeCommand: vi.fn() },
}));

vi.mock('../../../src/infrastructure/telemetry/telemetryService', () => ({
  TelemetryService: class {
    readonly dispose = vi.fn();
    private readonly flushed: Promise<void>;
    readonly resolveShutdown: () => void;
    readonly shutdown = vi.fn(async () => {
      await this.flushed;
      this.dispose();
    });
    constructor(readonly context: vscode.ExtensionContext) {
      let resolve!: () => void;
      this.flushed = new Promise<void>((done) => {
        resolve = done;
      });
      this.resolveShutdown = resolve;
      mocks.instances.push(this);
    }
  },
}));

vi.mock('../../../src/application/studyController', () => ({
  StudyController: class {
    readonly dispose = mocks.controllerDispose;
    constructor(...args: unknown[]) {
      mocks.controllerConstructor(...args);
    }
  },
}));

vi.mock('../../../src/webview/host/studyWebviewProvider', () => ({
  StudyWebviewProvider: class {
    readonly dispose = mocks.providerDispose;
    constructor(...args: unknown[]) {
      mocks.providerConstructor(...args);
    }
  },
}));

import { activate, deactivate } from '../../../src/extension';

function context(extensionMode = 1): vscode.ExtensionContext {
  return {
    extensionMode,
    extensionUri: { toString: () => 'file:///extension' },
    globalState: { get: vi.fn(), update: vi.fn() },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registerCommand.mockImplementation(() => ({ dispose: vi.fn() }));
  mocks.registerProvider.mockImplementation(() => ({ dispose: vi.fn() }));
});

afterEach(async () => {
  for (const instance of mocks.instances) instance.resolveShutdown();
  await deactivate();
  mocks.instances.length = 0;
});

describe('extension telemetry ownership', () => {
  it.each([1, 2])('does not expose telemetry test commands in mode %s', (mode) => {
    activate(context(mode));
    const registered = mocks.registerCommand.mock.calls.map(([name]) => name);
    expect(registered).not.toContain('leetcodeStudyHelper.__setTelemetryEnabled');
    expect(registered).not.toContain('leetcodeStudyHelper.__getTelemetryState');
  });

  it('exposes telemetry settings commands only in the integration test host', () => {
    activate(context(3));
    const registered = mocks.registerCommand.mock.calls.map(([name]) => name);
    expect(registered).toContain('leetcodeStudyHelper.__setTelemetryEnabled');
    expect(registered).toContain('leetcodeStudyHelper.__getTelemetryState');
  });

  it('keeps graceful shutdown alive while VS Code synchronously disposes subscriptions', async () => {
    const extensionContext = context();
    activate(extensionContext);
    const telemetry = mocks.instances[0]!;
    expect(telemetry.context).toBe(extensionContext);
    expect(extensionContext.subscriptions).not.toContain(telemetry);
    expect(mocks.controllerConstructor).toHaveBeenCalledExactlyOnceWith(
      extensionContext.extensionUri,
      extensionContext.globalState,
      telemetry,
    );
    expect(mocks.providerConstructor).toHaveBeenCalledExactlyOnceWith(
      extensionContext.extensionUri,
      expect.anything(),
      telemetry,
    );

    const deactivated = deactivate();
    for (const disposable of extensionContext.subscriptions) disposable.dispose();
    expect(telemetry.shutdown).toHaveBeenCalledOnce();
    expect(telemetry.dispose).not.toHaveBeenCalled();
    expect(mocks.controllerDispose).toHaveBeenCalledOnce();
    expect(mocks.providerDispose).toHaveBeenCalledOnce();
    telemetry.resolveShutdown();
    await deactivated;
    expect(telemetry.dispose).toHaveBeenCalledOnce();
    await deactivate();
    expect(telemetry.shutdown).toHaveBeenCalledOnce();
  });

  it('discards the service if controller construction fails during activation', async () => {
    const failure = new Error('controller initialization failed');
    mocks.controllerConstructor.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => activate(context())).toThrow(failure);
    const telemetry = mocks.instances[0]!;
    expect(telemetry.dispose).toHaveBeenCalledOnce();
    expect(telemetry.shutdown).not.toHaveBeenCalled();
    await deactivate();
    expect(telemetry.shutdown).not.toHaveBeenCalled();
  });

  it('discards the service if registration fails without performing a normal flush', async () => {
    const failure = new Error('provider registration failed');
    mocks.registerProvider.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => activate(context())).toThrow(failure);
    const telemetry = mocks.instances[0]!;
    expect(telemetry.dispose).toHaveBeenCalledOnce();
    expect(telemetry.shutdown).not.toHaveBeenCalled();
    await deactivate();
    expect(telemetry.shutdown).not.toHaveBeenCalled();
  });
});
