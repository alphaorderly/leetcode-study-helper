import type {
  ExtensionSnapshot,
  RepositorySnapshot,
} from '../core/types';
import { element, renderLoadingState } from './dom';
import type { PostMessage, UiState } from './viewTypes';

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

function renderSubmissionSummary(repository: RepositorySnapshot): HTMLElement {
  const summary = repository.submission?.summary;
  const region = element('div', 'submission-summary');
  if (!summary) {
    return region;
  }
  for (const [label, count, className] of [
    ['작성 중', summary.working, 'working'],
    ['커밋 준비', summary.staged, 'staged'],
    ['push 필요', summary.pushNeeded, 'push-needed'],
    ['PR 진행', summary.prPending, 'pr-pending'],
    ['병합 완료', summary.merged, 'merged'],
  ] as const) {
    const item = element('span', `submission-summary-item ${className}`);
    item.append(
      element('span', 'submission-summary-count', String(count)),
      element('span', 'submission-summary-label', label),
    );
    region.append(item);
  }
  return region;
}

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

function renderSubmissionGraph(
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
    graph.append(renderLoadingState(
      '제출 상태를 확인하는 중…',
      '포크, 커밋과 PR 상태를 불러오고 있습니다.',
    ));
    return graph;
  }
  if (submission.status === 'unsupported' || submission.status === 'unavailable') {
    const reason = submission.fork.reason
      ?? 'DaleStudy/leetcode-study 포크에서만 제출 기능을 사용할 수 있습니다.';
    if (submission.fork.needsGitHubSignIn) {
      const region = element('div', 'submission-auth');
      region.append(element('p', 'empty-state', reason));
      const button = element('button', 'primary-button', 'GitHub으로 로그인');
      button.type = 'button';
      button.disabled = ui.busy;
      button.addEventListener('click', () => post({ type: 'signInGitHub' }));
      region.append(button);
      graph.append(region);
      return graph;
    }
    graph.append(element('p', 'empty-state', reason));
    return graph;
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

  const hasUnpushed = submission.pendingCommits.some(({ pushed }) => !pushed);
  const pullRequestSnapshot = submission.pullRequest ?? submission.activePullRequest;
  const hasGraphContent = submission.stagedFiles.length > 0
    || submission.otherStagedFiles.length > 0
    || submission.pendingCommits.length > 0
    || submission.forkFiles.length > 0
    || submission.otherForkFiles.length > 0
    || Boolean(pullRequestSnapshot);
  if (!hasGraphContent) {
    if (!submission.hasCanonicalRemote || submission.behindOfficialMain) {
      const region = element('div', 'submission-auth');
      region.append(element(
        'p',
        'empty-state',
        '공식 DaleStudy 저장소와 맞춰야 주차 제출을 시작할 수 있습니다.',
      ));
      const button = element('button', 'primary-button', '공식 저장소 연결');
      button.type = 'button';
      button.disabled = ui.busy || !submission.canSync;
      if (!submission.canSync) {
        button.title = submission.syncDisabledReason
          ?? '스테이징·추적 파일 수정과 미푸시 커밋을 먼저 정리해 주세요.';
      }
      button.addEventListener('click', () =>
        post({ type: 'syncFork', rootUri: repository.rootUri })
      );
      region.append(button);
      graph.append(region);
      return graph;
    }
    graph.append(element(
      'p',
      'empty-state submission-empty',
      '문제 카드에서 풀이를 커밋에 추가하면 이곳에 제출 흐름이 나타납니다.',
    ));
    return graph;
  }

  const pullRequestStatusLabel = pullRequestSnapshot?.status === 'merged'
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
  pullRequestButton.disabled = ui.busy || (!pullRequestSnapshot && (
    Boolean(submission.blockedReason)
    || hasUnpushed
    || submission.forkFiles.length === 0
  ));
  if (!pullRequestSnapshot && hasUnpushed) {
    pullRequestButton.title = '로컬 커밋을 origin에 먼저 push해 주세요.';
  }
  pullRequestButton.addEventListener('click', () =>
    post({ type: 'openPullRequest', rootUri: repository.rootUri })
  );
  pullRequest.body.append(pullRequestButton);
  graph.append(pullRequest.node);

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
    pushButton.disabled = ui.busy || Boolean(submission.blockedReason);
    pushButton.addEventListener('click', () =>
      post({ type: 'pushActiveWeek', rootUri: repository.rootUri })
    );
    origin.body.append(pushButton);
  }
  graph.append(origin.node);

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
        element(
          'summary',
          undefined,
          `풀이 외 파일 ${commit.otherFiles.length}개 포함`,
        ),
        renderSubmissionFiles(
          commit.otherFiles.map((relativePath) => ({
            name: relativePath.split('/').pop() ?? relativePath,
            relativePath,
          })),
        ),
      );
      commitNode.body.append(warning);
    }
    graph.append(commitNode.node);
  }

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
    commitButton.disabled = ui.busy || Boolean(submission.blockedReason);
    commitButton.addEventListener('click', () => {
      messages[key] = input.value;
      post({
        type: 'commitActiveWeek',
        rootUri: repository.rootUri,
        message: input.value,
      });
    });
    staged.body.append(input, commitButton);
    graph.append(staged.node);
  }
  return graph;
}

export function renderSubmissionView(
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
  rerender: () => void,
): HTMLElement {
  const section = element('section', 'submission-view');
  section.setAttribute('role', 'tabpanel');
  const repositories = state.repositories;
  let repository = repositories.find(({ rootUri }) =>
    rootUri === ui.submissionRepository
  );
  repository ??= repositories.find(({ submission }) =>
    submission?.fork.status === 'verified'
  ) ?? repositories[0];
  if (!repository) {
    section.append(element('p', 'empty-state', '제출할 저장소가 없습니다.'));
    return section;
  }
  ui.submissionRepository = repository.rootUri;

  const header = element('div', 'submission-view-header');
  const titleGroup = element('div', 'submission-view-title-group');
  titleGroup.append(
    element('h2', 'submission-view-title', '주차별 제출'),
    element(
      'p',
      'submission-view-description',
      '커밋에 추가한 풀이만 병합 전까지 표시됩니다.',
    ),
  );
  const actions = element('div', 'submission-view-actions');
  const refreshButton = element(
    'button',
    'secondary-button submission-header-button',
    '새로고침',
  );
  refreshButton.type = 'button';
  refreshButton.disabled = ui.busy;
  refreshButton.addEventListener('click', () => post({ type: 'refreshSubmission' }));
  const syncButton = element(
    'button',
    'secondary-button submission-header-button',
    '포크 동기화',
  );
  syncButton.type = 'button';
  syncButton.disabled = ui.busy || !repository.submission?.canSync;
  syncButton.title = repository.submission?.canSync
    ? '공식 main 가져오기'
    : repository.submission?.syncDisabledReason
      ?? '스테이징·추적 파일 수정과 미푸시 커밋을 먼저 정리해 주세요.';
  syncButton.addEventListener('click', () =>
    post({ type: 'syncFork', rootUri: repository.rootUri })
  );
  const returnButton = element(
    'button',
    'secondary-button submission-header-button',
    'main으로 돌아가 동기화',
  );
  returnButton.type = 'button';
  returnButton.disabled = ui.busy || !repository.submission?.canReturnToMain;
  if (!repository.submission?.canReturnToMain) {
    returnButton.title = 'PR 병합과 깨끗한 주차 브랜치 상태를 먼저 확인해 주세요.';
  }
  returnButton.addEventListener('click', () =>
    post({ type: 'returnToMainAndSync', rootUri: repository.rootUri })
  );
  actions.append(refreshButton, syncButton);
  if (/^week-\d{2}$/.test(repository.submission?.branch ?? '')) {
    actions.append(returnButton);
  }
  header.append(titleGroup, actions);
  section.append(header);

  if (repositories.length > 1) {
    const select = element('select', 'select-input submission-repository-select');
    select.setAttribute('aria-label', '제출 저장소');
    for (const item of repositories) {
      const option = element('option', undefined, item.name);
      option.value = item.rootUri;
      option.selected = item.rootUri === repository.rootUri;
      select.append(option);
    }
    select.addEventListener('change', () => {
      ui.submissionRepository = select.value;
      rerender();
    });
    section.append(select);
  }
  section.append(
    renderSubmissionSummary(repository),
    renderSubmissionGraph(repository, state, ui, post),
  );
  return section;
}
