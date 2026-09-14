import { isValidNickname, solutionNickname } from './solutions';

export const OTHER_SOLUTION_CONSENT_KEY = 'otherSolutionSpoilerConfirmed';
export const OTHER_SOLUTION_CONFIRM_LABEL = '풀이 보기';

/** 다른 풀이 열람 동의를 읽고 저장하기 위한 영속 상태 계약입니다. */
export interface ConsentState {
  /** 저장된 값을 읽으며 키가 없으면 undefined를 반환합니다. */
  get<T>(key: string): T | undefined;
  /** 동의 값을 저장하고 저장 완료를 호출자에게 알립니다. */
  update(key: string, value: unknown): PromiseLike<void>;
}

/** README와 본인 풀이를 제외하고 유효한 다른 닉네임의 파일인지 확인합니다. */
export function isOtherSolutionFile(fileName: string, nickname: string): boolean {
  if (!nickname || fileName === 'README.md') {
    return false;
  }

  const candidateNickname = solutionNickname(fileName);
  return (
    candidateNickname !== undefined &&
    isValidNickname(candidateNickname) &&
    candidateNickname !== nickname
  );
}

/** 다른 참여자의 풀이 후보에서 선택합니다. 가능한 경우 선호 확장자를 사용하고 이전 선택을 피합니다. */
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

  const withoutImmediateRepeat =
    previousFileName && candidates.length > 1
      ? candidates.filter((fileName) => fileName !== previousFileName)
      : candidates;
  const preferred = withoutImmediateRepeat.filter((fileName) =>
    fileName.endsWith(`.${preferredExtension}`),
  );
  const pool = preferred.length > 0 ? preferred : withoutImmediateRepeat;
  const index = Math.min(Math.floor(random() * pool.length), pool.length - 1);
  return pool[index];
}

/** 저장된 동의가 없으면 확인을 요청하고 승인 결과를 보관합니다. */
export async function confirmOtherSolutionAccess(
  state: ConsentState,
  prompt: () => PromiseLike<string | undefined>,
): Promise<boolean> {
  if (state.get<boolean>(OTHER_SOLUTION_CONSENT_KEY) === true) {
    return true;
  }

  if ((await prompt()) !== OTHER_SOLUTION_CONFIRM_LABEL) {
    return false;
  }

  await state.update(OTHER_SOLUTION_CONSENT_KEY, true);
  return true;
}
