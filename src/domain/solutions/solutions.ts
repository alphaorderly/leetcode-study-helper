const NICKNAME_PATTERN = /^[A-Za-z0-9-]+$/;

/** 파일명에 사용할 닉네임이 영문·숫자·하이픈으로만 구성되었는지 검사합니다. */
export function isValidNickname(nickname: string): boolean {
  return NICKNAME_PATTERN.test(nickname);
}

/** 첫 점 앞의 닉네임을 반환하며 닉네임 구간이 없으면 undefined를 반환합니다. */
export function solutionNickname(fileName: string): string | undefined {
  const firstDot = fileName.indexOf('.');
  if (firstDot <= 0) {
    return undefined;
  }
  return fileName.slice(0, firstDot);
}

/** README를 제외하고 첫 점 앞의 닉네임을 대소문자까지 일치시켜 내 풀이인지 판별합니다. */
export function isMatchingSolution(fileName: string, nickname: string): boolean {
  if (!nickname || fileName === 'README.md') {
    return false;
  }
  return solutionNickname(fileName) === nickname;
}

/** 줄 끝 보정에서 제외할 Markdown 파일인지 확인합니다. */
export function isIgnoredByLineLint(fileName: string): boolean {
  return fileName.endsWith('.md');
}

/**
 * 파일 끝의 불필요한 빈 줄을 정리하고 마지막 LF를 보장합니다.
 * @returns 수정할 바이트. 변경이 없거나 빈 파일이면 undefined입니다.
 */
export function addMissingEndOfFileNewline(content: Uint8Array): Uint8Array | undefined {
  if (content.length === 0) {
    return undefined;
  }

  let lineStart = 0;
  let trailingBlankLinesStart: number | undefined;
  let hasLineFeed = false;

  for (let index = 0; index <= content.length; index += 1) {
    if (index < content.length && content[index] !== 0x0a) {
      continue;
    }

    let isBlankLine = true;
    for (let lineIndex = lineStart; lineIndex < index; lineIndex += 1) {
      const byte = content[lineIndex];
      if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0d) {
        isBlankLine = false;
        break;
      }
    }

    trailingBlankLinesStart = isBlankLine ? (trailingBlankLinesStart ?? lineStart) : undefined;
    if (index < content.length) {
      hasLineFeed = true;
      lineStart = index + 1;
    }
  }

  const normalizedLength =
    hasLineFeed && trailingBlankLinesStart !== undefined ? trailingBlankLinesStart : content.length;
  const needsNewline = normalizedLength === 0 || content[normalizedLength - 1] !== 0x0a;
  const fixedLength = normalizedLength + (needsNewline ? 1 : 0);
  if (fixedLength === content.length) {
    return undefined;
  }

  const fixed = new Uint8Array(fixedLength);
  fixed.set(content.subarray(0, normalizedLength));
  if (needsNewline) {
    fixed[fixed.length - 1] = 0x0a;
  }
  return fixed;
}

/** 생성할 파일명의 사용 가능 여부와 대소문자 충돌을 구분합니다. */
export type TargetFileStatus = 'available' | 'exists' | 'case-conflict';

/** 대상 이름의 기존 파일과 대소문자만 다른 파일을 구분해 생성 가능 여부를 반환합니다. */
export function targetFileStatus(entries: readonly string[], targetName: string): TargetFileStatus {
  if (entries.includes(targetName)) {
    return 'exists';
  }

  const normalizedTarget = targetName.toLocaleLowerCase('en-US');
  return entries.some((entry) => entry.toLocaleLowerCase('en-US') === normalizedTarget)
    ? 'case-conflict'
    : 'available';
}
