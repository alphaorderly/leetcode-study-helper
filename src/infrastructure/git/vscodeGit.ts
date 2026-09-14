import * as path from 'node:path';
import * as vscode from 'vscode';
import { AsyncVersionCache } from '../../shared/async/asyncVersionCache';

/** Git 변경 항목의 현재·원래·이름 변경 대상 URI입니다. */
export interface GitChange {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
}

/** 현재 브랜치가 추적하는 원격 ref와 알려진 커밋입니다. */
export interface GitUpstreamRef {
  readonly remote: string;
  readonly name: string;
  readonly commit?: string;
}

/** 현재 브랜치의 이름, 커밋, upstream과 앞섬·뒤처짐 정보입니다. */
export interface GitBranch {
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: GitUpstreamRef;
  readonly ahead?: number;
  readonly behind?: number;
}

/** 로컬 또는 원격 ref 조회에 필요한 이름·커밋·remote 정보입니다. */
export interface GitRef {
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

/** Git remote의 이름과 fetch·push URL입니다. */
export interface GitRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

/** 로컬 Git에서 읽은 커밋 해시, 메시지와 부모 목록입니다. */
export interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
}

/** VS Code Git 확장이 제공하는 HEAD·remote·변경 파일과 상태 변경 이벤트입니다. */
export interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  readonly remotes: GitRemote[];
  readonly rebaseCommit?: GitCommit;
  readonly mergeChanges: GitChange[];
  readonly indexChanges: GitChange[];
  readonly workingTreeChanges: GitChange[];
  readonly untrackedChanges: GitChange[];
  readonly onDidChange: vscode.Event<unknown>;
}

/** 확장에서 사용하는 VS Code Git 저장소 API의 최소 계약입니다. */
export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  /** 지정 ref를 커밋으로 해석하며 조회 실패는 거부된 Promise로 전달합니다. */
  getCommit(ref: string): Promise<GitCommit>;
  /** 두 ref의 공통 조상을 조회하며 공통 조상이 없으면 undefined입니다. */
  getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;
  /** 두 ref 사이의 변경 파일을 조회합니다. */
  diffBetween(ref1: string, ref2: string): Promise<GitChange[]>;
  /** 범위·순서·개수 제한을 적용해 커밋 이력을 읽습니다. */
  log(options?: { maxEntries?: number; range?: string; reverse?: boolean }): Promise<GitCommit[]>;
  /** 지정 경로를 Git index에 스테이징합니다. */
  add(paths: string[]): Promise<void>;
  /** 지정 경로의 스테이징을 해제합니다. */
  revert(paths: string[]): Promise<void>;
  /** 지정 경로의 작업 트리 변경을 되돌립니다. */
  clean(paths: string[]): Promise<void>;
  /** 현재 index를 메시지와 옵션에 따라 커밋합니다. */
  commit(
    message: string,
    options?: {
      requireUserConfig?: boolean;
      postCommitCommand?: string | null;
    },
  ): Promise<void>;
  /** 지정 기준에서 브랜치를 만들고 요청 시 해당 브랜치로 전환합니다. */
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  /** 조회 패턴에 맞는 로컬·원격 ref 목록을 반환합니다. */
  getRefs(query: { pattern?: string | string[] }): Promise<GitRef[]>;
  /** 지정 브랜치 또는 ref로 작업 트리를 전환합니다. */
  checkout(treeish: string): Promise<void>;
  /** 원격 ref를 가져오고 요청 시 오래된 원격 추적 ref를 정리합니다. */
  fetch(options?: { remote?: string; ref?: string; prune?: boolean }): Promise<void>;
  /** 지정 브랜치를 원격으로 push하고 요청 시 upstream을 설정합니다. */
  push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
  /** 지정 ref를 현재 브랜치에 병합합니다. */
  merge(ref: string): Promise<void>;
  /** 진행 중인 병합을 중단합니다. */
  mergeAbort(): Promise<void>;
  /** 이름과 URL로 새 remote를 등록합니다. */
  addRemote(name: string, url: string): Promise<void>;
  /** 브랜치가 추적할 upstream ref를 설정합니다. */
  setBranchUpstream(name: string, upstream: string): Promise<void>;
  /** 디스크의 Git 상태를 다시 읽어 저장소 상태를 갱신합니다. */
  status(): Promise<void>;
}

/** Git 저장소 목록과 열림·닫힘·확장 상태 이벤트를 제공하는 API입니다. */
interface GitApi {
  readonly repositories: GitRepository[];
  readonly onDidChangeState: vscode.Event<unknown>;
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
  /** URI에 대응하는 Git 저장소를 찾으며 없으면 null입니다. */
  getRepository(uri: vscode.Uri): GitRepository | null;
}

/** VS Code 내장 Git 확장의 활성 여부와 API 접근 계약입니다. */
interface GitExtension {
  readonly enabled: boolean;
  /** 이 확장에서 사용하는 버전 1 Git API를 반환합니다. */
  getAPI(version: 1): GitApi;
}

/** upstream 이름에 remote 접두사가 없을 때만 붙여 정규화합니다. */
export function upstreamRef(upstream: GitUpstreamRef): string {
  return upstream.name.startsWith(`${upstream.remote}/`)
    ? upstream.name
    : `${upstream.remote}/${upstream.name}`;
}

/** 브랜치 이름을 로컬 또는 원격의 전체 ref 조회 패턴으로 변환합니다. */
export function gitRefLookupPattern(name: string): string {
  return name.includes('/') ? `refs/remotes/${name}` : `refs/heads/${name}`;
}

/** 변경 전후와 이름 변경 URI를 대상 집합에 누적합니다. */
export function addChangeUris(target: Set<string>, changes: readonly GitChange[]): void {
  for (const change of changes) {
    target.add(change.uri.toString());
    target.add(change.originalUri.toString());
    if (change.renameUri) {
      target.add(change.renameUri.toString());
    }
  }
}

/** URI를 저장소 루트 기준의 슬래시 구분 상대 경로로 변환합니다. */
export function relativeGitPath(root: vscode.Uri, uri: vscode.Uri): string {
  return path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
}

/** 변경 전후와 이름 변경 경로를 저장소 상대 경로 집합에 누적합니다. */
export function addRelativeChangePaths(
  target: Set<string>,
  root: vscode.Uri,
  changes: readonly GitChange[],
): void {
  for (const change of changes) {
    target.add(relativeGitPath(root, change.uri));
    target.add(relativeGitPath(root, change.originalUri));
    if (change.renameUri) {
      target.add(relativeGitPath(root, change.renameUri));
    }
  }
}

/** 변경 목록에서 중복 없는 저장소 상대 경로 집합을 생성합니다. */
export function relativeChangePaths(root: vscode.Uri, changes: readonly GitChange[]): Set<string> {
  const paths = new Set<string>();
  addRelativeChangePaths(paths, root, changes);
  return paths;
}

/** 스킴·authority와 디렉터리 경계를 확인해 URI 포함 관계를 판정합니다. */
function uriContains(parent: vscode.Uri, child: vscode.Uri): boolean {
  if (parent.scheme !== child.scheme || parent.authority !== child.authority) {
    return false;
  }
  const parentPath = parent.path.endsWith('/') ? parent.path : `${parent.path}/`;
  return child.path === parent.path || child.path.startsWith(parentPath);
}

/** HEAD·remote·변경 경로를 직렬화해 중복 상태 이벤트를 판별할 값을 만듭니다. */
export function repositoryFingerprint(repository: GitRepository): string {
  const {
    HEAD,
    remotes,
    rebaseCommit,
    mergeChanges,
    indexChanges,
    workingTreeChanges,
    untrackedChanges,
  } = repository.state;
  /** 변경 URI를 정렬해 이벤트 순서와 무관하게 비교할 수 있도록 합니다. */
  const changeFingerprint = (changes: readonly GitChange[]): string[] =>
    changes.map(({ uri }) => uri.toString()).sort();
  return JSON.stringify([
    HEAD?.name,
    HEAD?.commit,
    HEAD?.upstream?.remote,
    HEAD?.upstream?.name,
    HEAD?.upstream?.commit,
    HEAD?.ahead,
    HEAD?.behind,
    remotes.map(({ name, fetchUrl, pushUrl }) => [name, fetchUrl, pushUrl]),
    rebaseCommit?.hash,
    changeFingerprint(mergeChanges),
    changeFingerprint(indexChanges),
    changeFingerprint(workingTreeChanges),
    changeFingerprint(untrackedChanges),
  ]);
}

/** VS Code Git 확장의 저장소 탐색·이벤트와 커밋 차이 캐시를 관리합니다. */
export class GitRepositoryAdapter implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repositorySubscriptions = new Map<string, vscode.Disposable>();
  private readonly repositoryFingerprints = new Map<string, string>();
  private readonly committedChanges = new AsyncVersionCache<ReadonlySet<string>>();
  private apiPromise: Promise<GitApi | undefined> | undefined;

  readonly onDidChange = this.changeEmitter.event;

  /** Git API에서 지정 루트를 포함하는 저장소를 찾으며 사용할 수 없으면 undefined입니다. */
  async getRepository(repositoryRoot: vscode.Uri): Promise<GitRepository | undefined> {
    const api = await this.getApi();
    if (!api) {
      return undefined;
    }
    const repository = api.getRepository(repositoryRoot) ?? undefined;
    if (repository && uriContains(repository.rootUri, repositoryRoot)) {
      return repository;
    }
    return api.repositories.find(({ rootUri }) => uriContains(rootUri, repositoryRoot));
  }

  /** 지정 루트의 저장소를 반환하며 찾지 못하면 오류를 던집니다. */
  async requireRepository(repositoryRoot: vscode.Uri): Promise<GitRepository> {
    const repository = await this.getRepository(repositoryRoot);
    if (!repository) {
      throw new Error('현재 워크스페이스의 Git 저장소를 찾을 수 없습니다.');
    }
    return repository;
  }

  /** upstream과 공통 조상 이후 HEAD의 변경 URI를 커밋 버전별로 캐시합니다. */
  async getCommittedChanges(
    repository: GitRepository,
    upstream: GitUpstreamRef,
  ): Promise<ReadonlySet<string>> {
    const repositoryKey = repository.rootUri.toString();
    const remoteRef = upstreamRef(upstream);
    const cacheKey = JSON.stringify([repository.state.HEAD?.commit, remoteRef, upstream.commit]);
    return this.committedChanges.get(repositoryKey, cacheKey, async () => {
      const uris = new Set<string>();
      const mergeBase = await repository.getMergeBase('HEAD', remoteRef);
      if (mergeBase) {
        addChangeUris(uris, await repository.diffBetween(mergeBase, 'HEAD'));
      }
      return uris;
    });
  }

  /** 저장소·API 구독과 변경 캐시를 해제하고 이벤트 발행기를 종료합니다. */
  dispose(): void {
    for (const subscription of this.repositorySubscriptions.values()) {
      subscription.dispose();
    }
    this.repositorySubscriptions.clear();
    this.repositoryFingerprints.clear();
    this.committedChanges.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
  }

  /** Git API 활성화 Promise를 재사용해 중복 초기화를 막습니다. */
  private getApi(): Promise<GitApi | undefined> {
    this.apiPromise ??= this.activateApi();
    return this.apiPromise;
  }

  /** 내장 Git 확장을 활성화하고 저장소 이벤트를 구독하며 사용 불가·실패 시 undefined입니다. */
  private async activateApi(): Promise<GitApi | undefined> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      return undefined;
    }
    try {
      const gitExtension = extension.isActive ? extension.exports : await extension.activate();
      if (!gitExtension.enabled) {
        return undefined;
      }
      const api = gitExtension.getAPI(1);
      for (const repository of api.repositories) {
        this.subscribeRepository(repository);
      }
      this.disposables.push(
        api.onDidChangeState(() => this.changeEmitter.fire()),
        api.onDidOpenRepository((repository) => {
          this.subscribeRepository(repository);
          this.changeEmitter.fire();
        }),
        api.onDidCloseRepository((repository) => {
          const key = repository.rootUri.toString();
          this.repositorySubscriptions.get(key)?.dispose();
          this.repositorySubscriptions.delete(key);
          this.repositoryFingerprints.delete(key);
          this.committedChanges.delete(key);
          this.changeEmitter.fire();
        }),
      );
      return api;
    } catch {
      return undefined;
    }
  }

  /** 저장소당 한 번 구독하고 상태 지문이 달라진 경우에만 변경을 발행합니다. */
  private subscribeRepository(repository: GitRepository): void {
    const key = repository.rootUri.toString();
    if (this.repositorySubscriptions.has(key)) {
      return;
    }
    this.repositoryFingerprints.set(key, repositoryFingerprint(repository));
    this.repositorySubscriptions.set(
      key,
      repository.state.onDidChange(() => {
        const fingerprint = repositoryFingerprint(repository);
        if (fingerprint === this.repositoryFingerprints.get(key)) {
          return;
        }
        this.repositoryFingerprints.set(key, fingerprint);
        this.changeEmitter.fire();
      }),
    );
  }
}
