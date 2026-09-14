const ANSWER_URL_PATTERN = /https:\/\/[^\s<>"'()[\]]+/gu;
const ANSWER_ORIGINS = new Set(['https://algodale.com', 'https://www.algodale.com']);

export const ANSWER_CONFIRM_LABEL = '이동';

/** 지원하는 정답 URL을 정규화합니다. 허용되지 않는 URL이면 undefined입니다. */
export function normalizeAnswerUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      !ANSWER_ORIGINS.has(url.origin) ||
      !url.pathname.startsWith('/problems/') ||
      url.pathname === '/problems/' ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

/** 문제 README의 정답 링크를 찾아 검증된 URL만 반환합니다. */
export function extractAnswerUrl(markdown: string): string | undefined {
  for (const match of markdown.matchAll(ANSWER_URL_PATTERN)) {
    const answerUrl = normalizeAnswerUrl(match[0]);
    if (answerUrl) {
      return answerUrl;
    }
  }
  return undefined;
}

/** 정답 공개 확인 결과가 지정된 승인 문구와 일치하는지 반환합니다. */
export async function confirmAnswerAccess(
  prompt: () => PromiseLike<string | undefined>,
): Promise<boolean> {
  return (await prompt()) === ANSWER_CONFIRM_LABEL;
}
