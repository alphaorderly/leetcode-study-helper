import {
  isValidNickname,
  solutionNickname,
} from './solutions';

export const OTHER_SOLUTION_CONSENT_KEY = 'otherSolutionSpoilerConfirmed';
export const OTHER_SOLUTION_CONFIRM_LABEL = '풀이 보기';

export interface ConsentState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export function isOtherSolutionFile(fileName: string, nickname: string): boolean {
  if (!nickname || fileName === 'README.md') {
    return false;
  }

  const candidateNickname = solutionNickname(fileName);
  return candidateNickname !== undefined
    && isValidNickname(candidateNickname)
    && candidateNickname !== nickname;
}

export function selectRandomOtherSolution(
  fileNames: readonly string[],
  nickname: string,
  preferredExtension: string,
  previousFileName?: string,
  random: () => number = Math.random,
): string | undefined {
  const candidates = fileNames
    .filter((fileName) => isOtherSolutionFile(fileName, nickname))
    .sort((left, right) => left.localeCompare(right));
  if (candidates.length === 0) {
    return undefined;
  }

  const withoutImmediateRepeat = previousFileName && candidates.length > 1
    ? candidates.filter((fileName) => fileName !== previousFileName)
    : candidates;
  const preferred = withoutImmediateRepeat.filter(
    (fileName) => fileName.endsWith(`.${preferredExtension}`),
  );
  const pool = preferred.length > 0 ? preferred : withoutImmediateRepeat;
  const index = Math.min(Math.floor(random() * pool.length), pool.length - 1);
  return pool[index];
}

export async function confirmOtherSolutionAccess(
  state: ConsentState,
  prompt: () => PromiseLike<string | undefined>,
): Promise<boolean> {
  if (state.get<boolean>(OTHER_SOLUTION_CONSENT_KEY) === true) {
    return true;
  }

  if (await prompt() !== OTHER_SOLUTION_CONFIRM_LABEL) {
    return false;
  }

  await state.update(OTHER_SOLUTION_CONSENT_KEY, true);
  return true;
}
