import * as path from 'node:path';
import * as vscode from 'vscode';
import { AsyncVersionCache } from '../core/asyncVersionCache';

export interface GitChange {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
}

export interface GitUpstreamRef {
  readonly remote: string;
  readonly name: string;
  readonly commit?: string;
}

export interface GitBranch {
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: GitUpstreamRef;
  readonly ahead?: number;
  readonly behind?: number;
}

export interface GitRef {
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

export interface GitRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
}

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

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  getCommit(ref: string): Promise<GitCommit>;
  getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;
  diffBetween(ref1: string, ref2: string): Promise<GitChange[]>;
  log(options?: {
    maxEntries?: number;
    range?: string;
    reverse?: boolean;
  }): Promise<GitCommit[]>;
  add(paths: string[]): Promise<void>;
  revert(paths: string[]): Promise<void>;
  commit(message: string, options?: {
    requireUserConfig?: boolean;
    postCommitCommand?: string | null;
  }): Promise<void>;
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  getRefs(query: { pattern?: string | string[] }): Promise<GitRef[]>;
  checkout(treeish: string): Promise<void>;
  fetch(options?: { remote?: string; ref?: string; prune?: boolean }): Promise<void>;
  push(
    remoteName?: string,
    branchName?: string,
    setUpstream?: boolean,
  ): Promise<void>;
  merge(ref: string): Promise<void>;
  mergeAbort(): Promise<void>;
  addRemote(name: string, url: string): Promise<void>;
  setBranchUpstream(name: string, upstream: string): Promise<void>;
  status(): Promise<void>;
}

interface GitApi {
  readonly repositories: GitRepository[];
  readonly onDidChangeState: vscode.Event<unknown>;
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

export function upstreamRef(upstream: GitUpstreamRef): string {
  return upstream.name.startsWith(`${upstream.remote}/`)
    ? upstream.name
    : `${upstream.remote}/${upstream.name}`;
}

export function gitRefLookupPattern(name: string): string {
  return name.includes('/')
    ? `refs/remotes/${name}`
    : `refs/heads/${name}`;
}

export function addChangeUris(
  target: Set<string>,
  changes: readonly GitChange[],
): void {
  for (const change of changes) {
    target.add(change.uri.toString());
    target.add(change.originalUri.toString());
    if (change.renameUri) {
      target.add(change.renameUri.toString());
    }
  }
}

export function relativeGitPath(root: vscode.Uri, uri: vscode.Uri): string {
  return path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
}

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

export function relativeChangePaths(
  root: vscode.Uri,
  changes: readonly GitChange[],
): Set<string> {
  const paths = new Set<string>();
  addRelativeChangePaths(paths, root, changes);
  return paths;
}

function uriContains(parent: vscode.Uri, child: vscode.Uri): boolean {
  if (parent.scheme !== child.scheme || parent.authority !== child.authority) {
    return false;
  }
  const parentPath = parent.path.endsWith('/') ? parent.path : `${parent.path}/`;
  return child.path === parent.path || child.path.startsWith(parentPath);
}

function repositoryFingerprint(repository: GitRepository): string {
  const {
    HEAD,
    remotes,
    rebaseCommit,
    mergeChanges,
    indexChanges,
    workingTreeChanges,
    untrackedChanges,
  } = repository.state;
  const changeFingerprint = (changes: readonly GitChange[]): string[] =>
    changes.map(({ uri }) => uri.toString()).sort();
  return JSON.stringify([
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

export class GitRepositoryAdapter implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repositorySubscriptions = new Map<string, vscode.Disposable>();
  private readonly repositoryFingerprints = new Map<string, string>();
  private readonly committedChanges = new AsyncVersionCache<ReadonlySet<string>>();
  private apiPromise: Promise<GitApi | undefined> | undefined;

  readonly onDidChange = this.changeEmitter.event;

  async getRepository(repositoryRoot: vscode.Uri): Promise<GitRepository | undefined> {
    const api = await this.getApi();
    if (!api) {
      return undefined;
    }
    const repository = api.getRepository(repositoryRoot) ?? undefined;
    if (repository && uriContains(repository.rootUri, repositoryRoot)) {
      return repository;
    }
    return api.repositories.find(
      ({ rootUri }) => uriContains(rootUri, repositoryRoot),
    );
  }

  async requireRepository(repositoryRoot: vscode.Uri): Promise<GitRepository> {
    const repository = await this.getRepository(repositoryRoot);
    if (!repository) {
      throw new Error('현재 워크스페이스의 Git 저장소를 찾을 수 없습니다.');
    }
    return repository;
  }

  async getCommittedChanges(
    repository: GitRepository,
    upstream: GitUpstreamRef,
  ): Promise<ReadonlySet<string>> {
    const repositoryKey = repository.rootUri.toString();
    const remoteRef = upstreamRef(upstream);
    const cacheKey = JSON.stringify([
      repository.state.HEAD?.commit,
      remoteRef,
      upstream.commit,
    ]);
    return this.committedChanges.get(repositoryKey, cacheKey, async () => {
      const uris = new Set<string>();
      const mergeBase = await repository.getMergeBase('HEAD', remoteRef);
      if (mergeBase) {
        addChangeUris(uris, await repository.diffBetween(mergeBase, 'HEAD'));
      }
      return uris;
    });
  }

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

  private getApi(): Promise<GitApi | undefined> {
    this.apiPromise ??= this.activateApi();
    return this.apiPromise;
  }

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
