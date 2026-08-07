import type { GitRepository } from './vscodeGit';

export type GitRefRelation = 'equal' | 'ahead' | 'behind' | 'diverged';

export async function getRefRelation(
  repository: GitRepository,
  remoteRef: string,
): Promise<GitRefRelation> {
  const [head, remote] = await Promise.all([
    repository.getCommit('HEAD'),
    repository.getCommit(remoteRef),
  ]);
  if (head.hash === remote.hash) {
    return 'equal';
  }
  const mergeBase = await repository.getMergeBase('HEAD', remoteRef);
  if (mergeBase === remote.hash) {
    return 'ahead';
  }
  if (mergeBase === head.hash) {
    return 'behind';
  }
  return 'diverged';
}
