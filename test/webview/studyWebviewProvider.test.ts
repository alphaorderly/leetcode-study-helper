import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExtensionSnapshot,
  ExtensionToWebviewMessage,
  TelemetrySettingsSnapshot,
} from '../../src/shared/contracts';
import type { TelemetrySettingsPort } from '../../src/webview/host/studyWebviewProvider';
import { createSnapshot } from './renderFixtures';

/** 표시 상태 변경을 테스트에서 직접 발생시키는 이벤트입니다. */
function eventSource<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    event: (listener: (value: T) => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (value: T) => {
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
}

/** 실제 VS Code와 통계 요청 없이 웹뷰 메시지 경계를 구성합니다. */
async function createProvider(withTelemetry = true) {
  const showErrorMessage = vi.fn(async () => undefined);
  vi.doMock('vscode', () => ({
    Uri: { joinPath: (_base: unknown, ...parts: string[]) => parts.join('/') },
    window: { showErrorMessage },
  }));
  const { StudyWebviewProvider } = await import('../../src/webview/host/studyWebviewProvider.js');
  const changes = eventSource<ExtensionSnapshot>();
  const currentChanges = eventSource<undefined>();
  const telemetryChanges = eventSource<TelemetrySettingsSnapshot>();
  const snapshot = createSnapshot();
  const controller = {
    currentSnapshot: snapshot,
    getState: vi.fn(async () => snapshot),
    saveSettings: vi.fn(async () => {}),
    handleOnboardingAction: vi.fn(async () => {}),
    onDidChange: changes.event,
    onDidChangeCurrentProblem: currentChanges.event,
  };
  let telemetryState: TelemetrySettingsSnapshot = { enabled: false, effectiveEnabled: false };
  const setEnabled = vi.fn(async (enabled: boolean) => {
    telemetryState = { enabled, effectiveEnabled: enabled };
  });
  const observe = vi.fn(async () => {});
  const telemetry: TelemetrySettingsPort = {
    get state() {
      return telemetryState;
    },
    onDidChangeState: telemetryChanges.event,
    setEnabled,
    observe,
  };
  const provider = new StudyWebviewProvider(
    {} as never,
    controller as never,
    withTelemetry ? telemetry : undefined,
  );
  let receive: ((message: unknown) => void) | undefined;
  const postMessage = vi.fn<(message: ExtensionToWebviewMessage) => Promise<boolean>>(
    async () => true,
  );
  const view = {
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: string) => uri,
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        receive = listener;
        return { dispose: vi.fn() };
      },
      postMessage,
    },
  };
  provider.resolveWebviewView(view as never);
  return {
    provider,
    controller,
    snapshot,
    changes,
    telemetryChanges,
    setEnabled,
    observe,
    postMessage,
    showErrorMessage,
    send: (message: unknown) => receive?.(message),
  };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('vscode');
});

describe('StudyWebviewProvider telemetry settings', () => {
  it('adds disabled defaults without changing controller snapshots', async () => {
    const harness = await createProvider(false);
    harness.send({ type: 'ready' });

    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith({
        type: 'state',
        state: {
          ...harness.snapshot,
          telemetry: { enabled: false, effectiveEnabled: false },
        },
      });
    });
    expect(harness.snapshot.telemetry).toBeUndefined();
    harness.provider.dispose();
  });

  it('observes ready and full states but sends telemetry changes as partial patches', async () => {
    const harness = await createProvider();
    harness.send({ type: 'ready' });
    await vi.waitFor(() => expect(harness.postMessage).toHaveBeenCalledTimes(1));
    expect(harness.observe).toHaveBeenCalledWith(harness.snapshot, { viewOpened: true });
    const updated = { ...harness.snapshot, nickname: 'AnotherUser' };
    harness.changes.fire(updated);
    expect(harness.observe).toHaveBeenCalledWith(updated, { viewOpened: false });
    expect(harness.postMessage).toHaveBeenLastCalledWith({
      type: 'state',
      state: { ...updated, telemetry: { enabled: false, effectiveEnabled: false } },
    });
    harness.postMessage.mockClear();

    const state: TelemetrySettingsSnapshot = {
      enabled: true,
      effectiveEnabled: false,
      disabledReason: 'vscode',
    };
    harness.telemetryChanges.fire(state);

    expect(harness.postMessage.mock.calls).toEqual([[{ type: 'telemetryState', state }]]);
    harness.provider.dispose();
    harness.telemetryChanges.fire(state);
    harness.changes.fire(updated);
    expect(harness.postMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects nonboolean commands and saves consent without busy or repository refresh', async () => {
    const harness = await createProvider();
    for (const message of [
      { type: 'setTelemetryEnabled', enabled: 'false' },
      { type: 'setTelemetryEnabled', enabled: 1 },
      { type: 'setTelemetryEnabled', enabled: null },
      { type: 'setTelemetryEnabled' },
    ]) {
      harness.send(message);
    }
    expect(harness.setEnabled).not.toHaveBeenCalled();
    harness.send({ type: 'setTelemetryEnabled', enabled: true });

    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith({
        type: 'telemetryState',
        state: { enabled: true, effectiveEnabled: true },
      });
    });
    expect(harness.setEnabled).toHaveBeenCalledExactlyOnceWith(true);
    expect(harness.controller.getState).not.toHaveBeenCalled();
    expect(harness.controller.saveSettings).not.toHaveBeenCalled();
    expect(harness.postMessage.mock.calls.every(([message]) => message.type !== 'busy')).toBe(true);
    harness.provider.dispose();
  });

  it('restores the displayed consent value when saving fails', async () => {
    const harness = await createProvider();
    harness.setEnabled.mockRejectedValueOnce(new Error('설정을 저장하지 못했습니다.'));
    harness.send({ type: 'setTelemetryEnabled', enabled: true });

    await vi.waitFor(() => {
      expect(harness.showErrorMessage).toHaveBeenCalledWith('설정을 저장하지 못했습니다.');
    });
    expect(harness.postMessage.mock.calls).toEqual([
      [{ type: 'telemetryState', state: { enabled: false, effectiveEnabled: false } }],
    ]);
    harness.provider.dispose();
  });

  it('keeps rendering when asynchronous observation fails', async () => {
    const harness = await createProvider();
    harness.observe.mockRejectedValueOnce(new Error('관측 실패'));
    harness.send({ type: 'ready' });

    await vi.waitFor(() => expect(harness.postMessage).toHaveBeenCalledTimes(1));
    expect(harness.showErrorMessage).not.toHaveBeenCalled();
    harness.provider.dispose();
  });
});

describe('StudyWebviewProvider onboarding messages', () => {
  it('forwards known actions with an optional string target inside a busy window', async () => {
    const harness = await createProvider(false);
    harness.send({ type: 'onboarding', action: 'openNestedFolder', target: 'file:///dev/x' });
    harness.send({ type: 'onboarding', action: 'recheck' });

    await vi.waitFor(() => {
      expect(harness.controller.handleOnboardingAction).toHaveBeenCalledTimes(2);
    });
    expect(harness.controller.handleOnboardingAction).toHaveBeenNthCalledWith(
      1,
      'openNestedFolder',
      'file:///dev/x',
    );
    expect(harness.controller.handleOnboardingAction).toHaveBeenNthCalledWith(
      2,
      'recheck',
      undefined,
    );
    expect(harness.postMessage).toHaveBeenCalledWith({ type: 'busy', value: true });
    expect(harness.postMessage).toHaveBeenCalledWith({ type: 'busy', value: false });
    harness.provider.dispose();
  });

  it('drops unknown actions and non-string targets', async () => {
    const harness = await createProvider(false);
    for (const message of [
      { type: 'onboarding' },
      { type: 'onboarding', action: 'formatDisk' },
      { type: 'onboarding', action: 42 },
      { type: 'onboarding', action: 'openNestedFolder', target: { uri: 'file:///x' } },
      { type: 'onboarding', action: 'openNestedFolder', target: 1 },
      { type: 'onboarding', action: 'toString' },
    ]) {
      harness.send(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.controller.handleOnboardingAction).not.toHaveBeenCalled();
    harness.provider.dispose();
  });

  it('shows controller failures as VS Code errors', async () => {
    const harness = await createProvider(false);
    harness.controller.handleOnboardingAction.mockRejectedValueOnce(new Error('클론 실패'));
    harness.send({ type: 'onboarding', action: 'cloneRepository' });
    await vi.waitFor(() => expect(harness.showErrorMessage).toHaveBeenCalledWith('클론 실패'));
    harness.provider.dispose();
  });
});
