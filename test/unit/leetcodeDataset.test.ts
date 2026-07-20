import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface DatasetProblem {
  taskId: string;
  questionId: number;
  entryPoint: string;
  methodName: string;
  test: string;
  requiredObjects: string[];
}

interface DatasetFile {
  source: { dataset: string; revision: string; license: string };
  problemCount: number;
  missing: string[];
  problems: Record<string, DatasetProblem>;
}

const dataset = JSON.parse(
  readFileSync('resources/leetcode-python-tests.json', 'utf8'),
) as DatasetFile;

describe('filtered LeetCodeDataset asset', () => {
  it('contains the expected current-problem coverage and pinned source', () => {
    expect(dataset.source).toMatchObject({
      dataset: 'newfacade/LeetCodeDataset',
      revision: '215604aeed660029df7de2fea5a4d7b6ed476a08',
      license: 'apache-2.0',
    });
    expect(dataset.problemCount).toBe(68);
    expect(Object.keys(dataset.problems)).toHaveLength(68);
    expect(dataset.missing).toEqual([
      'clone-graph',
      'design-add-and-search-words-data-structure',
      'encode-and-decode-strings',
      'find-median-from-data-stream',
      'implement-trie-prefix-tree',
      'lowest-common-ancestor-of-a-binary-search-tree',
      'serialize-and-deserialize-binary-tree',
    ]);
  });

  it('keeps only execution fields and marks object-dependent tests', () => {
    expect(dataset.problems['two-sum']?.requiredObjects).toEqual([]);
    expect(dataset.problems['reverse-linked-list']?.requiredObjects).toEqual(['ListNode']);
    expect(dataset.problems['maximum-depth-of-binary-tree']?.requiredObjects)
      .toEqual(['TreeNode']);
    expect(dataset.problems['two-sum']).not.toHaveProperty('completion');
    expect(dataset.problems['two-sum']).not.toHaveProperty('response');
    expect(dataset.problems['two-sum']?.entryPoint).toBe('Solution().twoSum');
  });
});
