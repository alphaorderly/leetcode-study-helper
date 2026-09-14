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

/**
 * 다른 닉네임의 코드 파일 중 선호 확장자가 있으면 그 집합을 먼저 선택합니다.
 * 선택된 집합에 대안이 있을 때만 직전 파일을 제외하므로 반복 선택이 불가피할 수 있습니다.
 * @param random 0 이상 1 미만의 난수 공급자. 테스트에서 선택 결과를 고정할 수 있습니다.
 * @returns 선택한 파일명. 후보가 없으면 undefined이며 파일을 열거나 변경하지 않습니다.
 */
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

/**
 * 이미 저장된 동의가 있으면 prompt를 호출하지 않습니다. 신규 동의는 지정 확인 문구와
 * 일치할 때만 저장하며 취소는 false입니다. 저장 실패는 전달해 동의 기록 없이 열람을 진행하지 않게 합니다.
 */
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
