import type {
  RepositorySnapshot,
  RepositorySubmissionSnapshot,
  SubmissionCommitSnapshot,
} from '../../shared/contracts';
import { actionButton, pathDetails, renderFileList } from '../components/controls';
import { element, renderLoadingState } from '../components/dom';
import {
  blockingFilesModel,
  commitAction,
  commitMessageKey,
  defaultCommitMessage,
  emptySyncAction,
  pullRequestAction,
  pullRequestStatusLabel,
  pushAction,
  submissionAuthBanner,
  submissionGraphFacts,
  submissionGraphLayout,
  submissionNoticeTexts,
  weekPad,
  type GraphAction,
  type SubmissionGraphFacts,
} from '../state/submissionGraphModel';
import type { ViewContext } from '../state/viewTypes';

/** 제출 단계 DOM 생성에 공유할 저장소·제출 상태와 파생 플래그입니다. */
interface SubmissionRenderContext extends ViewContext {
  repository: RepositorySnapshot;
  submission: RepositorySubmissionSnapshot;
  facts: SubmissionGraphFacts;
}

/**
 * 표시 모델이 결정한 레이아웃을 DOM으로 조립합니다. 타임라인은 PR → origin → 최신 커밋 →
 * 스테이징 순서입니다. 이 렌더 순서는 실제 Git 작업 순서와 다릅니다.
 * 인증 배너·로컬 이력 경고는 원격 조회 실패 중에도 확보된 작업 정보를 보여주기 위해 함께 그립니다.
 */
export function renderSubmissionGraph(
  repository: RepositorySnapshot,
  context: ViewContext,
): HTMLElement {
  const graph = element('div', 'submission-graph');
  const submission = repository.submission;
  /** 레이아웃 판단은 표시 모델에 위임합니다. 여기서는 결정된 화면의 DOM을 조립하고 버튼 이벤트만 연결합니다. */
  const layout = submissionGraphLayout(submission);

  if (layout.type === 'loading') {
    graph.append(renderLoadingState(layout.title, layout.description));
    return graph;
  }
  if (layout.type === 'unsupported') {
    graph.append(element('p', 'empty-state', layout.reason));
    return graph;
  }
  if (layout.type === 'auth-only') {
    graph.append(renderAuthBanner(layout.reason, layout.needsSignIn, context));
    return graph;
  }
  if (!submission) {
    return graph;
  }

  const facts = submissionGraphFacts(submission);
  /** 한 번 계산한 파생 플래그와 같은 저장소 스냅샷을 각 노드에 전달합니다. 노드별로 다른 상태를 읽지 않습니다. */
  const renderContext: SubmissionRenderContext = { ...context, repository, submission, facts };
  const auth = submissionAuthBanner(submission);
  if (auth) {
    graph.append(renderAuthBanner(auth.reason, auth.needsSignIn, context));
  }
  appendSubmissionNotices(graph, submission);

  if (layout.type === 'empty-sync' || layout.type === 'empty-idle') {
    graph.append(renderEmptySubmission(renderContext, layout.type));
    return graph;
  }

  if (facts.showSyncIssue && submission.syncDisabledReason) {
    graph.append(element('p', 'issue', submission.syncDisabledReason));
    const blocking = renderBlockingTrackedFiles(renderContext);
    if (blocking) {
      graph.append(blocking);
    }
  }

  /** 화면은 제출 목적지에서 로컬 작업 쪽으로 읽습니다. PR→origin→커밋→스테이징 순서는 실제 명령 실행 순서가 아닙니다. */
  graph.append(
    renderPullRequestNode(renderContext),
    renderOriginNode(renderContext),
    ...renderCommitNodes(submission),
  );
  const staged = renderStagedNode(renderContext);
  if (staged) {
    graph.append(staged);
  }
  return graph;
}

/** GitHub 조회 실패 안내와 필요하면 로그인 버튼을 만듭니다. */
function renderAuthBanner(
  reason: string,
  needsSignIn: boolean,
  { ui, post }: ViewContext,
): HTMLElement {
  const region = element('div', 'submission-auth');
  region.append(element('p', 'empty-state', reason));
  if (needsSignIn) {
    region.append(
      graphButton({
        className: 'primary-button',
        label: 'GitHub으로 로그인',
        disabled: ui.busy,
        onClick: () => post({ type: 'signInGitHub' }),
      }),
    );
  }
  return region;
}

/** 이력 조회 문제, 제출 차단 사유와 풀이 외 스테이징 경고를 그래프에 추가합니다. */
function appendSubmissionNotices(
  graph: HTMLElement,
  submission: RepositorySubmissionSnapshot,
): void {
  for (const text of submissionNoticeTexts(submission)) {
    graph.append(element('p', 'issue submission-blocked', text));
  }
  if (submission.otherStagedFiles.length > 0) {
    graph.append(
      pathDetails(
        `풀이 외 스테이징 파일 ${submission.otherStagedFiles.length}개`,
        submission.otherStagedFiles,
      ),
    );
  }
}

/** 제출할 변경이 없을 때 동기화 필요 여부에 맞는 안내와 작업 버튼을 만듭니다. */
function renderEmptySubmission(
  context: SubmissionRenderContext,
  layout: 'empty-sync' | 'empty-idle',
): DocumentFragment {
  const regionRoot = document.createDocumentFragment();
  if (layout === 'empty-idle') {
    regionRoot.append(
      element(
        'p',
        'empty-state submission-empty',
        '문제 카드에서 풀이를 커밋에 추가하면 이곳에 제출 흐름이 나타납니다.',
      ),
    );
    return regionRoot;
  }
  const { repository, submission, ui, post } = context;
  const region = element('div', 'submission-auth');
  region.append(
    element('p', 'empty-state', '공식 main을 포크에 반영하면 주차를 시작할 수 있습니다.'),
  );
  if (!submission.canSync && submission.syncDisabledReason) {
    region.append(element('p', 'issue', submission.syncDisabledReason));
  }
  const blocking = renderBlockingTrackedFiles(context);
  if (blocking) {
    region.append(blocking);
  }
  region.append(
    graphButton({
      ...emptySyncAction(repository.rootUri, submission, ui),
      className: 'primary-button',
      onClick: () => post({ type: 'syncFork', rootUri: repository.rootUri }),
    }),
  );
  regionRoot.append(region);
  return regionRoot;
}

/** 동기화를 막는 파일 목록과 풀이 외 변경 되돌리기 동작을 표시합니다. */
function renderBlockingTrackedFiles({
  submission,
  repository,
  ui,
  post,
}: SubmissionRenderContext): HTMLElement | undefined {
  const model = blockingFilesModel(submission.blockingTrackedFiles);
  if (!model) {
    return undefined;
  }
  const region = element('div', 'submission-blocking-files');
  if (model.otherFiles.length > 0) {
    const warning = pathDetails(
      `풀이 외 추적 파일 ${model.otherFiles.length}개`,
      model.otherFiles.map(({ relativePath }) => relativePath),
      { open: true },
    );
    warning.append(
      graphButton({
        className: 'secondary-button',
        label: '풀이 외 변경 되돌리기',
        disabled: ui.busy,
        onClick: () => post({ type: 'discardOtherTrackedChanges', rootUri: repository.rootUri }),
      }),
    );
    region.append(warning);
  }
  if (model.stagedSolutions.length > 0) {
    region.append(
      element(
        'p',
        'issue',
        '스테이징된 풀이는 문제 카드에서 커밋에 추가를 해제한 뒤 동기화할 수 있습니다.',
      ),
    );
  }
  if (model.conflicts.length > 0) {
    region.append(
      pathDetails(
        `충돌 파일 ${model.conflicts.length}개`,
        model.conflicts.map(({ relativePath }) => relativePath),
        { open: true },
      ),
    );
  }
  return region;
}

/** 제출 단계의 표식·제목·설명과 세부 내용을 추가할 본문 영역을 만듭니다. */
function renderSubmissionNode(
  kind: string,
  title: string,
  description?: string,
): { node: HTMLElement; body: HTMLElement } {
  const node = element('section', `submission-node ${kind}`);
  const marker = element('span', 'submission-node-marker');
  marker.setAttribute('aria-hidden', 'true');
  const body = element('div', 'submission-node-body');
  const header = element('div', 'submission-node-header');
  header.append(element('strong', 'submission-node-title', title));
  if (description) {
    header.append(element('span', 'submission-node-description', description));
  }
  body.append(header);
  node.append(marker, body);
  return { node, body };
}

/** PR 상태와 열기 버튼을 표시하며 생성 조건이 부족하면 버튼을 비활성화합니다. */
function renderPullRequestNode(context: SubmissionRenderContext): HTMLElement {
  const { repository, submission, facts, ui, post } = context;
  const snapshot = facts.pullRequest;
  const pullRequest = renderSubmissionNode(
    'pull-request',
    snapshot ? `PR #${snapshot.number} · ${pullRequestStatusLabel(snapshot.status)}` : 'PR 만들기',
    snapshot?.title,
  );
  pullRequest.body.append(
    graphButton({
      ...pullRequestAction(repository.rootUri, submission, facts, ui),
      className: 'primary-button submission-action-button',
      onClick: () => post({ type: 'openPullRequest', rootUri: repository.rootUri }),
    }),
  );
  return pullRequest.node;
}

/** 원격 반영 파일과 미푸시 상태를 표시하고 필요할 때 push 버튼을 만듭니다. */
function renderOriginNode(context: SubmissionRenderContext): HTMLElement {
  const { repository, submission, facts, ui, post } = context;
  const origin = renderSubmissionNode(
    `origin${facts.hasUnpushed ? ' pending' : ' complete'}`,
    `origin/${submission.submissionBranch ?? 'main'}`,
    facts.hasUnpushed ? 'push하지 않은 커밋이 있습니다.' : '포크에 반영됨',
  );
  if (submission.forkFiles.length > 0) {
    origin.body.append(renderFileList(submission.forkFiles));
  }
  if (submission.otherForkFiles.length > 0) {
    origin.body.append(
      pathDetails(
        `풀이 외 파일 ${submission.otherForkFiles.length}개가 origin에 포함됨`,
        submission.otherForkFiles,
      ),
    );
  }
  if (facts.hasUnpushed) {
    origin.body.append(
      graphButton({
        ...pushAction(repository.rootUri, facts, ui),
        className: 'primary-button submission-action-button',
        onClick: () => post({ type: 'pushActiveWeek', rootUri: repository.rootUri }),
      }),
    );
  }
  return origin.node;
}

/** 제출 커밋을 역순으로 표시하고 풀이 외 파일과 파일 검사 실패를 함께 알립니다. */
function renderCommitNodes(submission: RepositorySubmissionSnapshot): HTMLElement[] {
  return [...submission.pendingCommits].reverse().map((commit) => renderCommitNode(commit));
}

/** 한 커밋의 풀이 파일과 검사 실패 안내를 노드로 만듭니다. */
function renderCommitNode(commit: SubmissionCommitSnapshot): HTMLElement {
  const commitNode = renderSubmissionNode(
    `commit${commit.pushed ? ' pushed' : ' local'}`,
    `commit ${commit.shortHash} · 풀이 ${commit.files.length}개`,
    commit.message,
  );
  if (commit.files.length > 0) {
    commitNode.body.append(renderFileList(commit.files));
  }
  if (commit.otherFiles.length > 0) {
    commitNode.body.append(
      pathDetails(`풀이 외 파일 ${commit.otherFiles.length}개 포함`, commit.otherFiles),
    );
  }
  if (commit.fileInspectionStatus === 'unavailable') {
    commitNode.body.append(
      element(
        'p',
        'issue',
        commit.fileInspectionReason ?? '이 커밋의 변경 파일을 확인할 수 없습니다.',
      ),
    );
  }
  return commitNode.node;
}

/** 저장소·주차별로 입력한 커밋 메시지를 재사용하고 입력 시점마다 보관합니다. */
function renderStagedNode(context: SubmissionRenderContext): HTMLElement | undefined {
  const { repository, submission, state, ui, post, facts } = context;
  if (submission.stagedFiles.length === 0) {
    return undefined;
  }
  const week = submission.activeSubmissionWeek;
  const staged = renderSubmissionNode(
    'staged',
    `커밋 준비 · 풀이 ${submission.stagedFiles.length}개`,
    week ? `Week ${weekPad(week)}` : undefined,
  );
  staged.body.append(renderFileList(submission.stagedFiles));
  const key = commitMessageKey(repository.rootUri, week);
  const messages = ui.commitMessages ?? (ui.commitMessages = {});
  const input = element('input', 'text-input submission-commit-input');
  input.type = 'text';
  input.placeholder = '커밋 메시지';
  input.value = messages[key] ?? defaultCommitMessage(state.nickname, week);
  input.addEventListener('input', () => {
    messages[key] = input.value;
  });
  const action = commitAction(repository.rootUri, facts, ui);
  staged.body.append(
    input,
    graphButton({
      ...action,
      className: 'primary-button submission-action-button',
      onClick: () => {
        messages[key] = input.value;
        post({
          type: 'commitActiveWeek',
          rootUri: repository.rootUri,
          message: input.value,
        });
      },
    }),
  );
  return staged.node;
}

/** 그래프 액션의 표시 속성을 버튼으로 만듭니다. */
function graphButton(
  action: Pick<GraphAction, 'label' | 'disabled' | 'title'> & {
    className: string;
    onClick: () => void;
  },
): HTMLButtonElement {
  return actionButton({
    className: action.className,
    label: action.label,
    disabled: action.disabled,
    title: action.title,
    onClick: action.onClick,
  });
}
