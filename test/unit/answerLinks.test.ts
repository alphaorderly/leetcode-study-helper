import { describe, expect, it, vi } from 'vitest';
import {
  ANSWER_CONFIRM_LABEL,
  confirmAnswerAccess,
  extractAnswerUrl,
  normalizeAnswerUrl,
} from '../../src/core/answerLinks';

describe('answer links', () => {
  it.each([
    [
      '- 문제: https://leetcode.com/problems/3sum/\n'
        + '- 풀이: https://www.algodale.com/problems/3sum/',
      'https://www.algodale.com/problems/3sum/',
    ],
    [
      '- 문제: https://leetcode.com/problems/two-sum/\n'
        + '- 해설: https://www.algodale.com/problems/two-sum/',
      'https://www.algodale.com/problems/two-sum/',
    ],
    [
      [
        '- 문제',
        '  - 유료: https://leetcode.com/problems/alien-dictionary/',
        '  - 무료: https://www.lintcode.com/problem/892/',
        '- 풀이: https://algodale.com/problems/alien-dictionary/',
      ].join('\n'),
      'https://algodale.com/problems/alien-dictionary/',
    ],
  ])('extracts the Algodale problem URL regardless of the README label', (markdown, expected) => {
    expect(extractAnswerUrl(markdown)).toBe(expected);
  });

  it.each([
    '',
    '- 문제: https://leetcode.com/problems/two-sum/',
    '- 풀이: http://www.algodale.com/problems/two-sum/',
    '- 풀이: https://algodale.com.evil.example/problems/two-sum/',
    '- 풀이: https://www.algodale.com/',
    '- 풀이: not-a-url',
  ])('ignores missing or invalid answer URLs', (markdown) => {
    expect(extractAnswerUrl(markdown)).toBeUndefined();
  });

  it('normalizes only supported HTTPS Algodale problem URLs', () => {
    expect(normalizeAnswerUrl('https://www.algodale.com/problems/two-sum'))
      .toBe('https://www.algodale.com/problems/two-sum');
    expect(normalizeAnswerUrl('https://www.algodale.com:444/problems/two-sum/'))
      .toBeUndefined();
  });

  it('asks for confirmation every time without remembering prior approval', async () => {
    const prompt = vi.fn(async () => ANSWER_CONFIRM_LABEL);

    await expect(confirmAnswerAccess(prompt)).resolves.toBe(true);
    await expect(confirmAnswerAccess(prompt)).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('does not approve navigation when the prompt is cancelled', async () => {
    await expect(confirmAnswerAccess(async () => undefined)).resolves.toBe(false);
  });
});
