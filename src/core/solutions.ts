const NICKNAME_PATTERN = /^[A-Za-z0-9-]+$/;

export function isValidNickname(nickname: string): boolean {
  return NICKNAME_PATTERN.test(nickname);
}

export function solutionNickname(fileName: string): string | undefined {
  const firstDot = fileName.indexOf('.');
  if (firstDot <= 0) {
    return undefined;
  }
  return fileName.slice(0, firstDot);
}

export function isMatchingSolution(fileName: string, nickname: string): boolean {
  if (!nickname || fileName === 'README.md') {
    return false;
  }
  return solutionNickname(fileName) === nickname;
}

export function isIgnoredByLineLint(fileName: string): boolean {
  return fileName.endsWith('.md');
}

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

  const normalizedLength = hasLineFeed && trailingBlankLinesStart !== undefined
    ? trailingBlankLinesStart
    : content.length;
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

export type TargetFileStatus = 'available' | 'exists' | 'case-conflict';

export function targetFileStatus(entries: readonly string[], targetName: string): TargetFileStatus {
  if (entries.includes(targetName)) {
    return 'exists';
  }

  const normalizedTarget = targetName.toLocaleLowerCase('en-US');
  return entries.some(
    (entry) => entry.toLocaleLowerCase('en-US') === normalizedTarget,
  )
    ? 'case-conflict'
    : 'available';
}
