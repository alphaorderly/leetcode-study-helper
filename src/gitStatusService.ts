import * as vscode from 'vscode';
import { AsyncVersionCache } from './core/asyncVersionCache';
import type { SolutionGitStatus } from './core/types';

interface GitChange {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
}

interface GitUpstreamRef {
  readonly remote: string;
  readonly name: string;
  readonly commit?: string;
}

interface GitBranch {
  readonly commit?: string;
  readonly upstream?: GitUpstreamRef;
  readonly ahead?: number;
  readonly behind?: number;
}

interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  readonly mergeChanges: GitChange[];
  readonly indexChanges: GitChange[];
  readonly workingTreeChanges: GitChange[];
  readonly untrackedChanges: GitChange[];
  readonly onDidChange: vscode.Event<unknown>;
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;
  diffBetween(ref1: string, ref2: string): Promise<GitChange[]>;
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

export interface SolutionGitStatusResult {
  remoteName?: string;
  statuses: ReadonlyMap<string, SolutionGitStatus>;
}

function upstreamRef(upstream: GitUpstreamRef): string {
  return upstream.name.startsWith(`${upstream.remote}/`)
    ? upstream.name
    : `${upstream.remote}/${upstream.name}`;
}

function addChangeUris(target: Set<string>, changes: readonly GitChange[]): void {
  for (const change of changes) {
    target.add(change.uri.toString());
    target.add(change.originalUri.toString());
    if (change.renameUri) {
      target.add(change.renameUri.toString());
    }
  }
}

function uriContains(parent: vscode.Uri, child: vscode.Uri): boolean {
  if (parent.scheme !== child.scheme || parent.authority !== child.authority) {
    return false;
  }
  const parentPath = parent.path.endsWith('/') ? parent.path : `${parent.path}/`;
  return child.path === parent.path || child.path.startsWith(parentPath);
}

function repositoryFingerprint(repository: GitRepository): string {
  const { HEAD, mergeChanges, indexChanges, workingTreeChanges, untrackedChanges } =
    repository.state;
  const changeFingerprint = (changes: readonly GitChange[]): string[] =>
    changes.map(({ uri }) => uri.toString()).sort();
  return JSON.stringify([
    HEAD?.commit,
    HEAD?.upstream?.remote,
    HEAD?.upstream?.name,
    HEAD?.upstream?.commit,
    HEAD?.ahead,
    HEAD?.behind,
    changeFingerprint(mergeChanges),
    changeFingerprint(indexChanges),
    changeFingerprint(workingTreeChanges),
    changeFingerprint(untrackedChanges),
  ]);
}

export class GitStatusService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repositorySubscriptions = new Map<string, vscode.Disposable>();
  private readonly repositoryFingerprints = new Map<string, string>();
  private readonly committedChanges = new AsyncVersionCache<ReadonlySet<string>>();
  private apiPromise: Promise<GitApi | undefined> | undefined;

  readonly onDidChange = this.changeEmitter.event;

  async getStatuses(
    repositoryRoot: vscode.Uri,
    solutionUris: readonly string[],
    forceStatus = false,
  ): Promise<SolutionGitStatusResult> {
    const statuses = new Map(
      solutionUris.map((uri) => [uri, 'unknown' as SolutionGitStatus]),
    );
    if (solutionUris.length === 0) {
      return { statuses };
    }

    const api = await this.getApi();
    const repository = api ? this.findRepository(api, repositoryRoot) : undefined;
    if (!repository) {
      return { statuses };
    }

    try {
      if (forceStatus) {
        await repository.status();
      }
      const upstream = repository.state.HEAD?.upstream;
      if (!upstream) {
        return { statuses };
      }
      const changedUris = new Set<string>();
      const { state } = repository;
      addChangeUris(changedUris, state.mergeChanges);
      addChangeUris(changedUris, state.indexChanges);
      addChangeUris(changedUris, state.workingTreeChanges);
      addChangeUris(changedUris, state.untrackedChanges);

      const committedChanges = await this.getCommittedChanges(repository, upstream);
      for (const uri of committedChanges) {
        changedUris.add(uri);
      }

      for (const uri of solutionUris) {
        statuses.set(uri, changedUris.has(uri) ? 'unpushed' : 'pushed');
      }
      return { remoteName: upstream.remote, statuses };
    } catch {
      return { statuses };
    }
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

  private findRepository(api: GitApi, rootUri: vscode.Uri): GitRepository | undefined {
    const repository = api.getRepository(rootUri) ?? undefined;
    if (repository && uriContains(repository.rootUri, rootUri)) {
      return repository;
    }
    return api.repositories.find(({ rootUri: gitRoot }) => uriContains(gitRoot, rootUri));
  }

  private async getCommittedChanges(
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
