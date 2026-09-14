import type { GitRepository } from './vscodeGit';

/** HEAD와 비교 ref의 동일·앞섬·뒤처짐·분기 관계입니다. */
export type GitRefRelation = 'equal' | 'ahead' | 'behind' | 'diverged';

/** 공통 조상과 commit 해시로 HEAD와 기준 ref의 equal·ahead·behind·diverged 관계를 판별합니다. */
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
