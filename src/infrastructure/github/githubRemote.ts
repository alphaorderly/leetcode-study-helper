import type { GitRemote } from '../git/vscodeGit';

export const CANONICAL_OWNER = 'DaleStudy';
export const CANONICAL_REPOSITORY = 'leetcode-study';
export const CANONICAL_FULL_NAME = `${CANONICAL_OWNER}/${CANONICAL_REPOSITORY}`;
export const CANONICAL_REMOTE_URL = `https://github.com/${CANONICAL_FULL_NAME}.git`;

/** GitHub remote URL에서 추출한 소유자·저장소 이름과 원래 URL입니다. */
export interface ParsedGitHubRemote {
  readonly owner: string;
  readonly repository: string;
  readonly url: string;
}

/** 지원하는 GitHub HTTPS·SSH URL을 해석하며 인식할 수 없으면 undefined입니다. */
function parseGitHubRemote(url: string | undefined): ParsedGitHubRemote | undefined {
  if (!url) {
    return undefined;
  }
  const trimmed = url.trim();
  const match = trimmed.match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  );
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return {
    owner: match[1],
    repository: match[2],
    url: trimmed,
  };
}

/** 소유자와 저장소 이름을 대소문자 구분 없이 비교합니다. */
function sameGitHubRepository(left: ParsedGitHubRemote, right: ParsedGitHubRemote): boolean {
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.repository.toLowerCase() === right.repository.toLowerCase()
  );
}

/** fetch와 push URL을 해석하고 서로 다른 GitHub 저장소를 가리키면 undefined를 반환합니다. */
export function parseConsistentRemote(
  remote: GitRemote | undefined,
): ParsedGitHubRemote | undefined {
  if (!remote) {
    return undefined;
  }
  const fetchUrl = remote.fetchUrl?.trim();
  const pushUrl = remote.pushUrl?.trim();
  const fetch = parseGitHubRemote(fetchUrl);
  const push = parseGitHubRemote(pushUrl);
  if ((fetchUrl && !fetch) || (pushUrl && !push)) {
    return undefined;
  }
  if (fetch && push && !sameGitHubRepository(fetch, push)) {
    return undefined;
  }
  return push ?? fetch;
}

/** URL이 공식 DaleStudy 저장소를 가리키는지 확인합니다. */
export function isCanonicalRemote(url: string | undefined): boolean {
  const parsed = parseGitHubRemote(url);
  return (
    parsed?.owner.toLowerCase() === CANONICAL_OWNER.toLowerCase() &&
    parsed.repository.toLowerCase() === CANONICAL_REPOSITORY.toLowerCase()
  );
}

/**
 * 공식 저장소 remote를 찾으며 upstream 이름을 우선합니다.
 * @throws 기존 upstream이 공식 저장소를 가리키지 않는 경우.
 */
export function resolveCanonicalRemoteName(remotes: readonly GitRemote[]): string | undefined {
  const namedUpstream = remotes.find(({ name }) => name === 'upstream');
  if (namedUpstream) {
    const parsed = parseConsistentRemote(namedUpstream);
    if (
      !parsed ||
      parsed.owner.toLowerCase() !== CANONICAL_OWNER.toLowerCase() ||
      parsed.repository.toLowerCase() !== CANONICAL_REPOSITORY.toLowerCase()
    ) {
      throw new Error(
        '기존 upstream이 DaleStudy/leetcode-study를 가리키지 않습니다. fetch/push URL을 모두 확인해 주세요.',
      );
    }
  }
  const canonicalNames = remotes.flatMap((remote) => {
    const parsed = parseConsistentRemote(remote);
    return parsed &&
      parsed.owner.toLowerCase() === CANONICAL_OWNER.toLowerCase() &&
      parsed.repository.toLowerCase() === CANONICAL_REPOSITORY.toLowerCase()
      ? [remote.name]
      : [];
  });
  if (canonicalNames.includes('upstream')) {
    return 'upstream';
  }
  return canonicalNames[0];
}
