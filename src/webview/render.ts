import type { CurrentProblemSnapshot, ExtensionSnapshot } from '../shared/contracts';
import { element } from './components/dom';
import { hasRepositories, listChromeHidden } from './state/shellModel';
import type { PostMessage, UiState, ViewContext } from './state/viewTypes';
import { CurrentProblemViewRenderer } from './views/currentProblemView';
import { renderProblemList } from './views/problemListView';
import { renderSettings } from './views/settingsView';
import {
  renderControls,
  renderIssues,
  renderLintAction,
  renderNotices,
  renderViewTabs,
} from './views/shellView';
import { renderSubmissionView } from './views/submissionView';

export type { GroupingMode, StatusFilter } from './state/problemViewModel';
export type { PostMessage, UiState, ViewMode } from './state/viewTypes';

/**
 * 브라우저에서 루트 DOM과 재사용 영역을 소유하는 렌더러입니다.
 * 전체 스냅샷은 관련 영역을 다시 그리고, 현재 문제 전용 메시지는 목록·제출 입력을 보존합니다.
 * UiState는 이벤트 핸들러와 공유하는 가변 객체이며 ExtensionSnapshot은 새 값으로 교체합니다.
 * 현재 문제 설명 DOM의 별도 재사용은 CurrentProblemViewRenderer에 위임합니다.
 */
export class WebviewRenderer {
  private readonly settingsRegion = element('div', 'app-region app-settings-region');
  private readonly noticesRegion = element('div', 'app-region app-notices-region');
  private readonly lintRegion = element('div', 'app-region app-lint-region');
  private readonly controlsRegion = element('div', 'app-region app-controls-region');
  private readonly tabsRegion = element('div', 'app-region app-tabs-region');
  private readonly contentRegion = element('div', 'app-region app-content-region');
  private readonly issuesRegion = element('div', 'app-region app-issues-region');
  private readonly currentProblemView = new CurrentProblemViewRenderer();
  private state: ExtensionSnapshot | undefined;

  /** UI 상태와 전송 함수를 보관하고 재사용할 화면 영역을 구성합니다. */
  constructor(
    private readonly root: HTMLElement,
    private readonly ui: UiState,
    private readonly post: PostMessage,
  ) {
    this.controlsRegion.append(renderControls(ui, () => this.renderList()));
    this.root.replaceChildren(
      this.settingsRegion,
      this.noticesRegion,
      this.lintRegion,
      this.controlsRegion,
      this.tabsRegion,
      this.contentRegion,
      this.issuesRegion,
    );
  }

  /** 렌더 함수에 넘길 현재 스냅샷·UI 상태와 전송 함수입니다. */
  private context(): ViewContext | undefined {
    if (!this.state) {
      return undefined;
    }
    return { state: this.state, ui: this.ui, post: this.post };
  }

  /** 전체 스냅샷을 교체하고 표시 영역과 작업 중 상태를 갱신합니다. */
  updateState(state: ExtensionSnapshot): void {
    this.state = state;
    if (!state.currentProblem && this.ui.viewMode === 'currentProblem') {
      this.ui.viewMode = 'list';
    }
    this.renderSettings();
    this.renderNotices();
    this.renderLint();
    this.renderTabs();
    this.renderContent();
    this.renderIssues();
    this.updateBusyAttribute();
  }

  /**
   * runner 결과처럼 자주 도착하는 부분 변경을 반영합니다. 전체 updateState로 대체하면
   * 제출 입력과 목록 DOM을 불필요하게 교체합니다. 현재 풀이가 사라진 경우에는 목록 탭으로 복귀합니다.
   */
  updateCurrentProblem(currentProblem: CurrentProblemSnapshot | undefined): void {
    if (!this.state) {
      return;
    }
    this.state = { ...this.state, currentProblem };
    if (!currentProblem && this.ui.viewMode === 'currentProblem') {
      this.ui.viewMode = 'list';
    }
    this.renderTabs();
    if (this.ui.viewMode === 'currentProblem' && currentProblem) {
      this.renderCurrentProblem(currentProblem);
    } else if (this.ui.viewMode === 'list' && !currentProblem) {
      this.renderList();
    }
  }

  /** 작업 중 상태가 달라졌을 때 관련 컨트롤과 현재 화면을 다시 렌더링합니다. */
  updateBusy(busy: boolean): void {
    if (this.ui.busy === busy) {
      return;
    }
    this.ui.busy = busy;
    this.renderSettings();
    this.renderLint();
    this.renderTabs();
    this.renderContent();
    this.updateBusyAttribute();
  }

  /** 현재 스냅샷의 설정 폼으로 설정 영역을 교체합니다. */
  private renderSettings(): void {
    const context = this.context();
    this.settingsRegion.replaceChildren(...(context ? [renderSettings(context)] : []));
  }

  /** 닉네임 미설정과 지원 저장소 미발견 안내를 갱신합니다. */
  private renderNotices(): void {
    this.noticesRegion.replaceChildren(...renderNotices(this.state));
  }

  /** 저장소 존재 여부에 따라 줄 끝 보정 버튼과 목록 컨트롤 노출을 갱신합니다. */
  private renderLint(): void {
    const context = this.context();
    const repos = hasRepositories(this.state);
    this.lintRegion.replaceChildren(...(context && repos ? [renderLintAction(context)] : []));
    this.controlsRegion.hidden = !repos;
  }

  /** 현재 문제와 저장소 상태에 맞춰 탭 영역과 선택 동작을 갱신합니다. */
  private renderTabs(): void {
    const context = this.context();
    this.tabsRegion.replaceChildren(
      ...(context && hasRepositories(this.state)
        ? [
            renderViewTabs(this.state?.currentProblem, context, () => {
              this.renderTabs();
              this.renderContent();
            }),
          ]
        : []),
    );
  }

  /** 선택한 탭에 맞춰 제출·현재 문제·문제 목록 화면을 표시합니다. */
  private renderContent(): void {
    const context = this.context();
    if (!context || !hasRepositories(this.state)) {
      this.contentRegion.replaceChildren();
      return;
    }
    const hideListChrome = listChromeHidden(this.ui);
    this.controlsRegion.hidden = hideListChrome;
    this.lintRegion.hidden = hideListChrome;
    if (hideListChrome) {
      this.contentRegion.replaceChildren(
        renderSubmissionView(context, () => {
          this.renderTabs();
          this.renderContent();
        }),
      );
      return;
    }
    this.controlsRegion.hidden = false;
    this.lintRegion.hidden = false;
    if (this.ui.viewMode === 'currentProblem' && context.state.currentProblem) {
      this.renderCurrentProblem(context.state.currentProblem);
      return;
    }
    this.renderList();
  }

  /** 목록 탭이 활성 상태일 때만 필터가 적용된 문제 목록으로 본문을 교체합니다. */
  private renderList(): void {
    const context = this.context();
    if (!context || !hasRepositories(this.state) || this.ui.viewMode !== 'list') {
      return;
    }
    this.contentRegion.replaceChildren(...renderProblemList(context));
  }

  /** 현재 문제 렌더러가 보존한 본문·실행 영역을 콘텐츠 영역에 연결합니다. */
  private renderCurrentProblem(currentProblem: CurrentProblemSnapshot): void {
    this.contentRegion.replaceChildren(this.currentProblemView.render(currentProblem, this.post));
  }

  /** 루트별 탐색 오류를 안내 문구로 변환해 오류 영역을 갱신합니다. */
  private renderIssues(): void {
    this.issuesRegion.replaceChildren(...renderIssues(this.state));
  }

  /** UI 작업 중 여부에 맞춰 루트 요소의 aria-busy 속성을 설정하거나 제거합니다. */
  private updateBusyAttribute(): void {
    if (this.ui.busy) {
      this.root.setAttribute('aria-busy', 'true');
    } else {
      this.root.removeAttribute('aria-busy');
    }
  }
}

const renderers = new WeakMap<HTMLElement, WebviewRenderer>();

/** 루트별 렌더러를 재사용해 전체 상태를 반영합니다. 최초 UI 상태와 전송 함수를 유지합니다. */
export function renderApp(
  root: HTMLElement,
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): void {
  let renderer = renderers.get(root);
  if (!renderer) {
    renderer = new WebviewRenderer(root, ui, post);
    renderers.set(root, renderer);
  }
  renderer.updateState(state);
}
