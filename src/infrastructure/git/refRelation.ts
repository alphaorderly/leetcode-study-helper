import type { GitRepository } from './vscodeGit';

/** HEAD와 비교 ref의 동일·앞섬·뒤처짐·분기 관계입니다. */
export type GitRefRelation = 'equal' | 'ahead' | 'behind' | 'diverged';

/**
 * 현재 HEAD를 기준으로 ref와의 조상 관계를 읽습니다. remoteRef가 조상이면 ahead,
 * HEAD가 조상이면 behind이며 공통 조상 부재도 diverged로 분류합니다.
 * fetch/status를 수행하지 않으므로 최신 원격 정보가 필요하면 호출자가 먼저 갱신해야 합니다.
 * @throws 커밋·공통 조상 조회 API의 오류를 그대로 전달합니다.
 */
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
