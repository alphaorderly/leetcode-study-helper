import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { findLanguage } from '../../domain/solutions/languages';
import { isValidNickname } from '../../domain/solutions/solutions';
import type { ExtensionSnapshot, TelemetrySettingsSnapshot } from '../../shared/contracts';
import {
  NOOP_USAGE_OPERATION,
  type UsageEventName,
  type UsageOperation,
  type UsageProperties,
  type UsageRecorder,
} from '../../shared/telemetry';
import { createUsageOperation } from '../../shared/usageOperation';
import { isUsageEventName, sanitizeUsageProperties } from './usageSchema';
import { UsageQueue, type BatchSender } from './usageQueue';

const CONFIGURATION = 'leetcodeStudyHelper';
const SETTING = 'telemetry.enabled';
const INSTALLATION_KEY = 'telemetry.installationId.v1';
const PROMPT_KEY = 'telemetry.promptShown.v1';
const SETUP_KEY = 'telemetry.setupReady.v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

/** 실제 네트워크를 사용하지 않고 수명·식별자·tracker를 검증할 수 있는 의존성입니다. */
export interface TelemetryServiceDependencies {
  sender?: BatchSender;
  uuid?: () => string;
  now?: () => number;
  timestamp?: () => string;
}

/** 동의·식별자·VS Code logger·큐를 소유하며 기능 명령에 예외나 네트워크 대기를 전달하지 않습니다. */
export class TelemetryService implements vscode.Disposable, UsageRecorder {
  private readonly logger: vscode.TelemetryLogger;
  private readonly queue: UsageQueue;
  private readonly emitter = new vscode.EventEmitter<TelemetrySettingsSnapshot>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private installationId: string | undefined;
  private identityPromise: Promise<void> | undefined;
  private storageFailed = false;
  private disposed = false;
  private closing = false;
  private epoch = 0;
  private lastAllowed = false;
  private stateRevision = 0;
  private settingsRevision = 0;
  private pendingSetting = false;
  private requestedEnabled: boolean | undefined;
  private settingsWrite: Promise<void> = Promise.resolve();
  private snapshot: ExtensionSnapshot | undefined;
  private viewOpened = false;
  private promptScheduled = false;
  private sessionRecorded = false;
  private setupRecorded = false;
  private accepted = false;
  private occurrence: string | undefined;
  readonly onDidChangeState = this.emitter.event;

  /** 호스트에 logger를 등록하고 설정 변경을 관찰합니다. 식별자는 동의가 확인된 경우에만 준비합니다. */
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly dependencies: TelemetryServiceDependencies = {},
  ) {
    this.setupRecorded = context.globalState.get<boolean>(SETUP_KEY, false);
    this.queue = new UsageQueue(() => this.allowed(), dependencies.sender);
    this.logger = vscode.env.createTelemetryLogger(
      {
        sendEventData: (name, data) => this.receive(name, data),
        sendErrorData: () => {},
      },
      { ignoreBuiltInCommonProperties: true, ignoreUnhandledErrors: true },
    );
    this.subscriptions.push(
      this.logger.onDidChangeEnableStates(() => {
        void this.reconcile();
      }),
      vscode.env.onDidChangeTelemetryEnabled(() => {
        void this.reconcile();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${CONFIGURATION}.${SETTING}`)) void this.reconcile();
      }),
    );
    void this.reconcile();
  }

  /** workspace 값은 동의를 대신하지 못하며 application 범위의 전역 선택만 읽습니다. */
  private preference(): boolean {
    if (this.requestedEnabled !== undefined) return this.requestedEnabled;
    return (
      vscode.workspace.getConfiguration(CONFIGURATION).inspect<boolean>(SETTING)?.globalValue ===
      true
    );
  }

  /** 실패 결과도 사용 통계이므로 errors-only 설정에서는 전송하지 않습니다. */
  private hostAllowsUsage(): boolean {
    return (
      this.context.extensionMode === vscode.ExtensionMode.Production &&
      vscode.env.isTelemetryEnabled &&
      this.logger.isUsageEnabled
    );
  }

  /** 큐 입력과 실제 전송 직전에 읽는 유효한 동의 상태입니다. */
  private allowed(): boolean {
    return (
      !this.disposed &&
      !this.pendingSetting &&
      this.preference() &&
      this.hostAllowsUsage() &&
      Boolean(this.installationId) &&
      !this.storageFailed
    );
  }

  /** 저장된 선택과 현재 송신 가능 여부를 구분해 웹뷰에 제공합니다. */
  get state(): TelemetrySettingsSnapshot {
    const enabled = this.preference();
    const state: TelemetrySettingsSnapshot = { enabled, effectiveEnabled: this.allowed() };
    if (enabled && this.storageFailed) state.disabledReason = 'storage';
    else if (enabled && this.context.extensionMode !== vscode.ExtensionMode.Production)
      state.disabledReason = 'development';
    else if (enabled && (!vscode.env.isTelemetryEnabled || !this.logger.isUsageEnabled))
      state.disabledReason = 'vscode';
    return state;
  }

  /** 잘못된 저장 ID는 새로 만들고 저장 완료 전에는 수집을 허용하지 않습니다. 실패 시 해당 세션을 중단합니다. */
  private async prepareIdentity(): Promise<void> {
    if (this.installationId || this.storageFailed) return;
    if (!this.identityPromise) {
      this.identityPromise = (async () => {
        try {
          const stored = this.context.globalState.get<string>(INSTALLATION_KEY);
          if (stored && UUID_PATTERN.test(stored)) this.installationId = stored;
          else {
            const id = (this.dependencies.uuid ?? randomUUID)();
            if (!UUID_PATTERN.test(id)) throw new Error('Invalid telemetry identity');
            await this.context.globalState.update(INSTALLATION_KEY, id);
            this.installationId = id;
          }
        } catch {
          this.storageFailed = true;
        }
      })();
    }
    await this.identityPromise;
  }

  /** 동의가 사라지면 이전 세대를 무효화하고 비동기 ID 준비 뒤에도 최신 설정만 반영합니다. */
  private async reconcile(): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.stateRevision;
    this.updateGate();
    if (this.preference() && !this.pendingSetting && this.hostAllowsUsage())
      await this.prepareIdentity();
    if (this.disposed || revision !== this.stateRevision) return;
    this.updateGate();
    this.emitter.fire(this.state);
    this.observeCurrent();
  }

  /** 허용 여부가 바뀌면 tracker와 큐의 동의 세대를 함께 갱신합니다. */
  private updateGate(): void {
    const allowed = this.allowed();
    if (allowed !== this.lastAllowed) {
      this.lastAllowed = allowed;
      this.epoch += 1;
      if (!allowed) this.queue.revoke();
    }
  }

  /** 체크박스는 닉네임 검증과 독립적으로 저장하며 쓰기를 직렬화해 최신 선택을 반영합니다. */
  async setEnabled(enabled: boolean): Promise<void> {
    if (typeof enabled !== 'boolean' || this.disposed) return;
    const revision = ++this.settingsRevision;
    this.requestedEnabled = enabled;
    this.pendingSetting = true;
    this.updateGate();
    this.emitter.fire(this.state);
    const write = this.settingsWrite
      .catch(() => {})
      .then(async () => {
        await vscode.workspace
          .getConfiguration(CONFIGURATION)
          .update(SETTING, enabled, vscode.ConfigurationTarget.Global);
      });
    this.settingsWrite = write;
    let saved = false;
    try {
      await write;
      saved = true;
    } finally {
      if (!this.disposed && revision === this.settingsRevision) {
        // 중단 저장이 실패해도 현재 세션의 중단 의사는 서버 전송보다 우선합니다.
        this.requestedEnabled = saved || enabled ? undefined : false;
        this.pendingSetting = false;
        await this.reconcile();
      }
    }
  }

  /** 준비된 목록을 보관하고 사이드바를 실제 연 경우에만 최초 안내·세션 기록을 검토합니다. */
  observe(snapshot: ExtensionSnapshot, options: { viewOpened?: boolean } = {}): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    if (options.viewOpened) this.viewOpened = true;
    this.observeCurrent();
  }

  /** 저장소 준비는 설정 저장 성공과 다르며 기존 설정과 늦은 동의도 현재 상태에서 판단합니다. */
  private setupReady(): boolean {
    return Boolean(
      this.snapshot?.repositories.length &&
      this.snapshot.nickname &&
      isValidNickname(this.snapshot.nickname) &&
      findLanguage(this.snapshot.preferredLanguage),
    );
  }

  /** 반복 스냅샷은 기능 이벤트가 아니며 최초 관측 두 종류만 중복 없이 처리합니다. */
  private observeCurrent(): void {
    if (!this.viewOpened || !this.snapshot?.repositories.length || this.disposed) return;
    void this.maybePrompt();
    if (!this.allowed()) return;
    const language = this.snapshot.preferredLanguage;
    if (!this.sessionRecorded)
      this.sessionRecorded = this.record('study_session_started', {
        setup_ready: this.setupReady(),
        preferred_language: language,
      });
    if (
      !this.setupRecorded &&
      this.setupReady() &&
      this.record('setup_ready', { preferred_language: language })
    ) {
      this.setupRecorded = true;
      void Promise.resolve(this.context.globalState.update(SETUP_KEY, true)).catch(() => {});
    }
  }

  /** 최초 안내는 전역 명시 선택·호스트 정책을 확인하고 한 번만 표시합니다. 닫기는 동의로 취급하지 않습니다. */
  private async maybePrompt(): Promise<void> {
    if (this.promptScheduled || !this.hostAllowsUsage() || this.pendingSetting) return;
    const configured = vscode.workspace
      .getConfiguration(CONFIGURATION)
      .inspect<boolean>(SETTING)?.globalValue;
    if (configured !== undefined || this.context.globalState.get<boolean>(PROMPT_KEY, false))
      return;
    this.promptScheduled = true;
    try {
      await this.context.globalState.update(PROMPT_KEY, true);
      if (
        this.disposed ||
        !this.hostAllowsUsage() ||
        vscode.workspace.getConfiguration(CONFIGURATION).inspect<boolean>(SETTING)?.globalValue !==
          undefined
      )
        return;
      const settingsRevision = this.settingsRevision;
      const choice = await vscode.window.showInformationMessage(
        '확장 개선을 위해 무작위 설치 식별자, 기능·문제·주차·언어·실행 결과를 PostHog(US)에 보내도 될까요? 닉네임·코드·파일 경로는 보내지 않습니다. 설정에서 언제든 변경할 수 있습니다.',
        '허용',
        '수집하지 않음',
      );
      if (
        !this.disposed &&
        choice &&
        settingsRevision === this.settingsRevision &&
        vscode.workspace.getConfiguration(CONFIGURATION).inspect<boolean>(SETTING)?.globalValue ===
          undefined
      ) {
        await this.setEnabled(choice === '허용');
      }
    } catch {
      /* 안내·설정 실패로 학습 기능을 막지 않습니다. */
    }
  }

  /** 시작 당시 동의 세대를 고정해 동의 전이나 재동의 전 작업을 나중에 전송하지 않습니다. */
  begin(name: UsageEventName, properties: UsageProperties = {}): UsageOperation {
    if (this.closing || !this.allowed() || !isUsageEventName(name)) return NOOP_USAGE_OPERATION;
    const epoch = this.epoch;
    return createUsageOperation(properties, {
      allowed: () => !this.closing && this.allowed() && epoch === this.epoch,
      now: this.dependencies.now ?? (() => performance.now()),
      timestamp: this.dependencies.timestamp ?? (() => new Date().toISOString()),
      emit: (result, timestamp) => {
        this.record(name, result, timestamp);
      },
    });
  }

  /** logger 경유 전송의 동기 수락 여부를 확인하며 예외·원문 데이터는 밖으로 전달하지 않습니다. */
  private record(name: UsageEventName, properties: UsageProperties, timestamp?: string): boolean {
    if (!this.allowed() || this.closing) return false;
    this.accepted = false;
    this.occurrence = timestamp;
    try {
      this.logger.logUsage(name, properties);
      return this.accepted;
    } catch {
      return false;
    } finally {
      this.occurrence = undefined;
    }
  }

  /** VS Code 접두사와 정제 이후에도 허용 이름·속성만 구성해 큐에 넣습니다. 자동 식별자는 사용하지 않습니다. */
  private receive(fullName: string, data: unknown): void {
    if (!this.allowed() || !this.installationId) return;
    const prefix = `${this.context.extension.id}/`;
    if (!fullName.startsWith(prefix)) return;
    const name = fullName.slice(prefix.length);
    if (!isUsageEventName(name)) return;
    const properties = sanitizeUsageProperties(name, data);
    if (!properties) return;
    const extensionVersion: unknown = this.context.extension.packageJSON.version;
    properties.schema_version = 1;
    properties.environment = 'production';
    if (typeof extensionVersion === 'string' && VERSION_PATTERN.test(extensionVersion))
      properties.extension_version = extensionVersion;
    if (VERSION_PATTERN.test(vscode.version)) properties.editor_version = vscode.version;
    properties.$process_person_profile = false;
    properties.$geoip_disable = true;
    this.accepted = this.queue.enqueue({
      event: name,
      distinct_id: this.installationId,
      timestamp:
        this.occurrence ?? (this.dependencies.timestamp ?? (() => new Date().toISOString()))(),
      properties,
    });
  }

  /** 일반 종료에서는 새 기록을 중단하고 유효한 동의 아래 제한 시간만 남은 이벤트를 전송합니다. */
  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.closing = true;
    await this.queue.shutdown();
    this.dispose();
  }

  /** 동기 해제는 전송 없이 현재 세대·타이머·구독을 폐기합니다. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch += 1;
    this.queue.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.logger.dispose();
    this.emitter.dispose();
  }
}
