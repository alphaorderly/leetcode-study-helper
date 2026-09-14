import type {
  BlockingTrackedFile,
  ExtensionSnapshot,
  RepositorySnapshot,
  RepositorySubmissionSnapshot,
} from '../../shared/contracts';
import { element, renderLoadingState } from './dom';
import type { PostMessage, UiState } from '../state/viewTypes';

/** 제출 단계 DOM 생성에 공유할 저장소·제출 상태·UI 상태와 메시지 전송 함수입니다. */
interface SubmissionRenderContext {
  repository: RepositorySnapshot;
  submission: RepositorySubmissionSnapshot;
  state: ExtensionSnapshot;
  ui: UiState;
  post: PostMessage;
}

/** 제출 파일의 저장소 상대 경로를 목록 요소로 표시합니다. */
function renderSubmissionFiles(
  files: readonly { relativePath: string; name: string }[],
): HTMLElement {
  const list = element('ul', 'submission-file-list');
  for (const file of files) {
    const item = element('li', 'submission-file', file.relativePath);
    item.title = file.relativePath;
    list.append(item);
  }
  return list;
}

/** 충돌·스테이징·풀이 외 변경 중 사용자에게 안내할 차단 파일을 고릅니다. */
function blockingFilesForDisplay(files: readonly BlockingTrackedFile[]): BlockingTrackedFile[] {
  return files.filter(
    (file) => file.state === 'conflict' || file.state === 'staged' || file.kind === 'other',
  );
}

/** 동기화를 막는 파일 목록과 풀이 외 변경 되돌리기 동작을 표시합니다. */
function renderBlockingTrackedFiles(
  submission: RepositorySubmissionSnapshot,
  repository: RepositorySnapshot,
  ui: UiState,
  post: PostMessage,
): HTMLElement | undefined {
  const files = blockingFilesForDisplay(submission.blockingTrackedFiles ?? []);
  if (files.length === 0) {
    return undefined;
  }
  const region = element('div', 'submission-blocking-files');
  const otherFiles = files.filter((file) => file.kind === 'other' && file.state !== 'conflict');
  const stagedSolutions = files.filter(
    (file) => file.kind === 'solution' && file.state === 'staged',
  );
  const conflicts = files.filter((file) => file.state === 'conflict');
  if (otherFiles.length > 0) {
    const warning = element('details', 'submission-other-files');
    warning.open = true;
    warning.append(
      element('summary', undefined, `풀이 외 추적 파일 ${otherFiles.length}개`),
      renderSubmissionFiles(
        otherFiles.map((file) => ({
          name: file.relativePath.split('/').pop() ?? file.relativePath,
          relativePath: file.relativePath,
        })),
      ),
    );
    const restore = element('button', 'secondary-button', '풀이 외 변경 되돌리기');
    restore.type = 'button';
    restore.disabled = ui.busy;
    restore.addEventListener('click', () =>
      post({ type: 'discardOtherTrackedChanges', rootUri: repository.rootUri }),
    );
    warning.append(restore);
    region.append(warning);
  }
  if (stagedSolutions.length > 0) {
    region.append(
      element(
        'p',
        'issue',
        '스테이징된 풀이는 문제 카드에서 커밋에 추가를 해제한 뒤 동기화할 수 있습니다.',
      ),
    );
  }
  if (conflicts.length > 0) {
    const warning = element('details', 'submission-other-files');
    warning.open = true;
    warning.append(
      element('summary', undefined, `충돌 파일 ${conflicts.length}개`),
      renderSubmissionFiles(
        conflicts.map((file) => ({
          name: file.relativePath.split('/').pop() ?? file.relativePath,
          relativePath: file.relativePath,
        })),
      ),
    );
    region.append(warning);
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

/** 조회 상태별 안내 뒤 PR, 원격, 커밋, 스테이징 순서로 제출 흐름을 만듭니다. */
export function renderSubmissionGraph(
  repository: RepositorySnapshot,
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): HTMLElement {
  const submission = repository.submission;
  const graph = element('div', 'submission-graph');
  if (!submission) {
    graph.append(renderLoadingState('제출 상태를 확인하는 중…'));
    return graph;
  }
  if (submission.status === 'checking') {
    graph.append(
      renderLoadingState('제출 상태를 확인하는 중…', '포크, 커밋과 PR 상태를 불러오고 있습니다.'),
    );
    return graph;
  }
  const hasLocalGraphContent =
    submission.stagedFiles.length > 0 ||
    submission.otherStagedFiles.length > 0 ||
    submission.pendingCommits.some(({ pushed }) => !pushed);
  if (submission.status === 'unsupported') {
    const reason =
      submission.fork.reason ??
      'DaleStudy/leetcode-study 포크에서만 제출 기능을 사용할 수 있습니다.';
    graph.append(element('p', 'empty-state', reason));
    return graph;
  }
  if (submission.status === 'unavailable') {
    const reason = submission.fork.reason ?? 'GitHub 원격 상태를 확인할 수 없습니다.';
    const region = element('div', 'submission-auth');
    if (submission.fork.needsGitHubSignIn) {
      region.append(element('p', 'empty-state', reason));
      const button = element('button', 'primary-button', 'GitHub으로 로그인');
      button.type = 'button';
      button.disabled = ui.busy;
      button.addEventListener('click', () => post({ type: 'signInGitHub' }));
      region.append(button);
      graph.append(region);
    } else {
      region.append(element('p', 'empty-state', reason));
      graph.append(region);
    }
    if (!hasLocalGraphContent) {
      return graph;
    }
  }

  appendSubmissionNotices(graph, submission);
  const context = { repository, submission, state, ui, post };
  const pullRequestSnapshot = submission.pullRequest ?? submission.activePullRequest;
  const hasGraphContent =
    submission.stagedFiles.length > 0 ||
    submission.otherStagedFiles.length > 0 ||
    submission.pendingCommits.length > 0 ||
    submission.forkFiles.length > 0 ||
    submission.otherForkFiles.length > 0 ||
    Boolean(pullRequestSnapshot);
  if (!hasGraphContent) {
    graph.append(renderEmptySubmission(context));
    return graph;
  }

  if (submission.behindOfficialMain && !submission.canSync && submission.syncDisabledReason) {
    graph.append(element('p', 'issue', submission.syncDisabledReason));
    const blocking = renderBlockingTrackedFiles(submission, repository, ui, post);
    if (blocking) {
      graph.append(blocking);
    }
  }

  graph.append(
    renderPullRequestNode(context),
    renderOriginNode(context),
    ...renderCommitNodes(submission),
  );
  const staged = renderStagedNode(context);
  if (staged) graph.append(staged);
  return graph;
}

/** 이력 조회 문제, 제출 차단 사유와 풀이 외 스테이징 경고를 그래프에 추가합니다. */
function appendSubmissionNotices(
  graph: HTMLElement,
  submission: RepositorySubmissionSnapshot,
): void {
  if (submission.localHistory?.status === 'unavailable') {
    graph.append(
      element(
        'p',
        'issue submission-blocked',
        submission.localHistory.reason ?? '로컬 커밋 기록을 확인할 수 없습니다.',
      ),
    );
  } else if (submission.localHistory?.usedLocalMainFallback) {
    graph.append(
      element(
        'p',
        'issue submission-blocked',
        submission.localHistory.reason ??
          '공식 remote가 없어 로컬 main 기준으로 커밋을 표시합니다.',
      ),
    );
  }
  if (submission.blockedReason) {
    graph.append(element('p', 'issue submission-blocked', submission.blockedReason));
  }
  if (submission.otherStagedFiles.length > 0) {
    const warning = element('details', 'submission-other-files');
    warning.append(
      element(
        'summary',
        undefined,
        `풀이 외 스테이징 파일 ${submission.otherStagedFiles.length}개`,
      ),
      renderSubmissionFiles(
        submission.otherStagedFiles.map((relativePath) => ({
          name: relativePath.split('/').pop() ?? relativePath,
          relativePath,
        })),
      ),
    );
    graph.append(warning);
  }
}

/** 제출할 변경이 없을 때 동기화 필요 여부에 맞는 안내와 작업 버튼을 만듭니다. */
function renderEmptySubmission({
  repository,
  submission,
  ui,
  post,
}: SubmissionRenderContext): DocumentFragment {
  const regionRoot = document.createDocumentFragment();
  if (!submission.hasCanonicalRemote || submission.behindOfficialMain) {
    const region = element('div', 'submission-auth');
    region.append(
      element('p', 'empty-state', '공식 main을 포크에 반영하면 주차를 시작할 수 있습니다.'),
    );
    if (!submission.canSync && submission.syncDisabledReason) {
      region.append(element('p', 'issue', submission.syncDisabledReason));
    }
    const blocking = renderBlockingTrackedFiles(submission, repository, ui, post);
    if (blocking) {
      region.append(blocking);
    }
    const button = element('button', 'primary-button', '지금 맞추기');
    button.type = 'button';
    button.disabled = ui.busy || !submission.canSync;
    if (!submission.canSync) {
      button.title =
        submission.syncDisabledReason ??
        '스테이징·풀이 외 추적 파일 수정과 미푸시 커밋을 먼저 정리해 주세요.';
    }
    button.addEventListener('click', () => post({ type: 'syncFork', rootUri: repository.rootUri }));
    region.append(button);
    regionRoot.append(region);
    return regionRoot;
  }
  regionRoot.append(
    element(
      'p',
      'empty-state submission-empty',
      '문제 카드에서 풀이를 커밋에 추가하면 이곳에 제출 흐름이 나타납니다.',
    ),
  );
  return regionRoot;
}

/** PR 상태와 열기 버튼을 표시하며 생성 조건이 부족하면 버튼을 비활성화합니다. */
function renderPullRequestNode({
  repository,
  submission,
  ui,
  post,
}: SubmissionRenderContext): HTMLElement {
  const hasUnpushed = submission.pendingCommits.some(({ pushed }) => !pushed);
  const remoteActionsUnavailable = submission.status === 'unavailable';
  const pullRequestSnapshot = submission.pullRequest ?? submission.activePullRequest;
  const pullRequestStatusLabel =
    pullRequestSnapshot?.status === 'merged'
      ? '병합 완료'
      : pullRequestSnapshot?.status === 'closed-unmerged'
        ? '종료됨 · 미병합'
        : '검토 중';
  const pullRequest = renderSubmissionNode(
    'pull-request',
    pullRequestSnapshot
      ? `PR #${pullRequestSnapshot.number} · ${pullRequestStatusLabel}`
      : 'PR 만들기',
    pullRequestSnapshot?.title,
  );
  const pullRequestButton = element(
    'button',
    'primary-button submission-action-button',
    pullRequestSnapshot ? 'GitHub에서 열기' : 'PR 작성 화면 열기',
  );
  pullRequestButton.type = 'button';
  pullRequestButton.disabled =
    ui.busy ||
    (!pullRequestSnapshot &&
      (Boolean(submission.blockedReason) ||
        remoteActionsUnavailable ||
        hasUnpushed ||
        submission.forkFiles.length === 0));
  if (!pullRequestSnapshot && hasUnpushed) {
    pullRequestButton.title = '로컬 커밋을 origin에 먼저 push해 주세요.';
  }
  pullRequestButton.addEventListener('click', () =>
    post({ type: 'openPullRequest', rootUri: repository.rootUri }),
  );
  pullRequest.body.append(pullRequestButton);
  return pullRequest.node;
}

/** 원격 반영 파일과 미푸시 상태를 표시하고 필요할 때 push 버튼을 만듭니다. */
function renderOriginNode({
  repository,
  submission,
  ui,
  post,
}: SubmissionRenderContext): HTMLElement {
  const hasUnpushed = submission.pendingCommits.some(({ pushed }) => !pushed);
  const remoteActionsUnavailable = submission.status === 'unavailable';
  const origin = renderSubmissionNode(
    `origin${hasUnpushed ? ' pending' : ' complete'}`,
    `origin/${submission.submissionBranch ?? 'main'}`,
    hasUnpushed ? 'push하지 않은 커밋이 있습니다.' : '포크에 반영됨',
  );
  if (submission.forkFiles.length > 0) {
    origin.body.append(renderSubmissionFiles(submission.forkFiles));
  }
  if (submission.otherForkFiles.length > 0) {
    const warning = element('details', 'submission-other-files');
    warning.append(
      element(
        'summary',
        undefined,
        `풀이 외 파일 ${submission.otherForkFiles.length}개가 origin에 포함됨`,
      ),
      renderSubmissionFiles(
        submission.otherForkFiles.map((relativePath) => ({
          name: relativePath.split('/').pop() ?? relativePath,
          relativePath,
        })),
      ),
    );
    origin.body.append(warning);
  }
  if (hasUnpushed) {
    const pushButton = element(
      'button',
      'primary-button submission-action-button',
      'origin에 push',
    );
    pushButton.type = 'button';
    pushButton.disabled = ui.busy || remoteActionsUnavailable || Boolean(submission.blockedReason);
    if (remoteActionsUnavailable) {
      pushButton.title = 'GitHub 원격 상태를 확인한 뒤 push할 수 있습니다.';
    }
    pushButton.addEventListener('click', () =>
      post({ type: 'pushActiveWeek', rootUri: repository.rootUri }),
    );
    origin.body.append(pushButton);
  }
  return origin.node;
}

/** 제출 커밋을 역순으로 표시하고 풀이 외 파일과 파일 검사 실패를 함께 알립니다. */
function renderCommitNodes(submission: RepositorySubmissionSnapshot): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  for (const commit of [...submission.pendingCommits].reverse()) {
    const commitNode = renderSubmissionNode(
      `commit${commit.pushed ? ' pushed' : ' local'}`,
      `commit ${commit.shortHash} · 풀이 ${commit.files.length}개`,
      commit.message,
    );
    if (commit.files.length > 0) {
      commitNode.body.append(renderSubmissionFiles(commit.files));
    }
    if (commit.otherFiles.length > 0) {
      const warning = element('details', 'submission-other-files');
      warning.append(
        element('summary', undefined, `풀이 외 파일 ${commit.otherFiles.length}개 포함`),
        renderSubmissionFiles(
          commit.otherFiles.map((relativePath) => ({
            name: relativePath.split('/').pop() ?? relativePath,
            relativePath,
          })),
        ),
      );
      commitNode.body.append(warning);
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
    nodes.push(commitNode.node);
  }

  return nodes;
}

/** 저장소·주차별로 입력한 커밋 메시지를 재사용하고 입력 시점마다 보관합니다. */
function renderStagedNode({
  repository,
  submission,
  state,
  ui,
  post,
}: SubmissionRenderContext): HTMLElement | undefined {
  const remoteActionsUnavailable = submission.status === 'unavailable';
  if (submission.stagedFiles.length > 0) {
    const week = submission.activeSubmissionWeek;
    const staged = renderSubmissionNode(
      'staged',
      `커밋 준비 · 풀이 ${submission.stagedFiles.length}개`,
      week ? `Week ${String(week).padStart(2, '0')}` : undefined,
    );
    staged.body.append(renderSubmissionFiles(submission.stagedFiles));
    const key = `${repository.rootUri}\u0000${week ?? 'unknown'}`;
    const messages = ui.commitMessages ?? (ui.commitMessages = {});
    const defaultMessage = week
      ? `[${state.nickname}] WEEK ${String(week).padStart(2, '0')} Solutions`
      : `[${state.nickname}] Solutions`;
    const input = element('input', 'text-input submission-commit-input');
    input.type = 'text';
    input.placeholder = '커밋 메시지';
    input.value = messages[key] ?? defaultMessage;
    input.addEventListener('input', () => {
      messages[key] = input.value;
    });
    const commitButton = element(
      'button',
      'primary-button submission-action-button',
      '이 주차 커밋',
    );
    commitButton.type = 'button';
    commitButton.disabled =
      ui.busy || remoteActionsUnavailable || Boolean(submission.blockedReason);
    commitButton.addEventListener('click', () => {
      messages[key] = input.value;
      post({
        type: 'commitActiveWeek',
        rootUri: repository.rootUri,
        message: input.value,
      });
    });
    staged.body.append(input, commitButton);
    return staged.node;
  }

  return undefined;
}
