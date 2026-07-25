const ANSWER_URL_PATTERN = /https:\/\/[^\s<>"'()[\]]+/gu;
const ANSWER_ORIGINS = new Set([
  'https://algodale.com',
  'https://www.algodale.com',
]);

export const ANSWER_CONFIRM_LABEL = '이동';

export function normalizeAnswerUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      !ANSWER_ORIGINS.has(url.origin)
      || !url.pathname.startsWith('/problems/')
      || url.pathname === '/problems/'
      || url.username
      || url.password
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function extractAnswerUrl(markdown: string): string | undefined {
  for (const match of markdown.matchAll(ANSWER_URL_PATTERN)) {
    const answerUrl = normalizeAnswerUrl(match[0]);
    if (answerUrl) {
      return answerUrl;
    }
  }
  return undefined;
}

export async function confirmAnswerAccess(
  prompt: () => PromiseLike<string | undefined>,
): Promise<boolean> {
  return await prompt() === ANSWER_CONFIRM_LABEL;
}
