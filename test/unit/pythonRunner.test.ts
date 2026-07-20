import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface DatasetProblem {
  entryPoint: string;
  test: string;
  requiredObjects: string[];
}

const dataset = JSON.parse(
  readFileSync('resources/leetcode-python-tests.json', 'utf8'),
) as { problems: Record<string, DatasetProblem> };

function runner(request: Record<string, unknown>): Record<string, unknown> {
  const result = spawnSync(
    'python3',
    ['-I', '-u', 'resources/python/leetcode_runner.py'],
    { input: JSON.stringify(request), encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe('Python LeetCode runner', () => {
  it('discovers repeated classes and repeated methods independently', () => {
    const source = [
      'class Solution:',
      '    def twoSum(self, nums, target):',
      '        return None',
      '    def twoSum(self, nums, target):',
      '        return [0, 1]',
      'class Solution:',
      '    def twoSum(self, nums, target):',
      '        return [1, 0]',
    ].join('\n');
    const result = runner({
      mode: 'inspect',
      source,
      filename: 'solution.py',
      slug: 'two-sum',
      entryPoint: 'Solution().twoSum',
      requiredObjects: [],
    });

    expect(result.ok).toBe(true);
    expect(result.missingObjects).toEqual([]);
    expect(result.candidates).toMatchObject([
      { id: 'c0m0', methodLine: 2 },
      { id: 'c0m1', methodLine: 4 },
      { id: 'c1m0', methodLine: 7 },
    ]);
  });

  it('does not require linked-list or tree classes for ordinary problems', () => {
    const data = dataset.problems['two-sum']!;
    const result = runner({
      mode: 'inspect',
      source: 'class Solution:\n    def twoSum(self, nums, target): return [0, 1]\n',
      filename: 'solution.py',
      slug: 'two-sum',
      entryPoint: data.entryPoint,
      requiredObjects: data.requiredObjects,
    });

    expect(result.missingObjects).toEqual([]);
  });

  it('reports a required ListNode without defining it', () => {
    const data = dataset.problems['reverse-linked-list']!;
    const result = runner({
      mode: 'inspect',
      source: 'class Solution:\n    def reverseList(self, head): return head\n',
      filename: 'solution.py',
      slug: 'reverse-linked-list',
      entryPoint: data.entryPoint,
      requiredObjects: data.requiredObjects,
    });

    expect(result.missingObjects).toEqual(['ListNode']);
  });

  it('uses a user-defined ListNode when constructing test inputs', () => {
    const source = [
      'class ListNode:',
      '    def __init__(self, val=0, next=None):',
      '        self.val = val',
      '        self.next = next',
      'class Solution:',
      '    def reverseList(self, head):',
      '        previous = None',
      '        while head:',
      '            head.next, previous, head = previous, head, head.next',
      '        return previous',
    ].join('\n');
    const result = runner({
      mode: 'run',
      source,
      filename: 'solution.py',
      slug: 'reverse-linked-list',
      entryPoint: 'Solution().reverseList',
      requiredObjects: ['ListNode'],
      test: [
        'def check(candidate):',
        '    assert is_same_list(candidate(list_node([1, 2, 3])), list_node([3, 2, 1]))',
      ].join('\n'),
      candidateId: 'c0m0',
    });

    expect(result).toMatchObject({ ok: true, outcome: 'passed', passed: 1, total: 1 });
  });

  it('reports the first failing assertion and passed count', () => {
    const result = runner({
      mode: 'run',
      source: 'class Solution:\n    def answer(self, value): return value\n',
      filename: 'solution.py',
      slug: 'sample',
      entryPoint: 'Solution().answer',
      requiredObjects: [],
      test: [
        'def check(candidate):',
        '    assert candidate(1) == 1',
        '    assert candidate(2) == 3',
        '    assert candidate(4) == 4',
      ].join('\n'),
      candidateId: 'c0m0',
    });

    expect(result).toMatchObject({
      ok: true,
      outcome: 'failed',
      passed: 1,
      total: 3,
      failedCase: 2,
    });
    expect(result.assertion).toContain('candidate(2) == 3');
  });
});
