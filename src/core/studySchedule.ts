export const WEEKLY_PROBLEM_SLUGS = [
  [
    'contains-duplicate',
    'two-sum',
    'top-k-frequent-elements',
    'longest-consecutive-sequence',
    'house-robber',
  ],
  [
    'valid-anagram',
    'climbing-stairs',
    'product-of-array-except-self',
    '3sum',
    'validate-binary-search-tree',
  ],
  [
    'valid-palindrome',
    'number-of-1-bits',
    'combination-sum',
    'decode-ways',
    'maximum-subarray',
  ],
  [
    'merge-two-sorted-lists',
    'maximum-depth-of-binary-tree',
    'find-minimum-in-rotated-sorted-array',
    'word-search',
    'coin-change',
  ],
  [
    'best-time-to-buy-and-sell-stock',
    'group-anagrams',
    'encode-and-decode-strings',
    'implement-trie-prefix-tree',
    'word-break',
  ],
  [
    'valid-parentheses',
    'container-with-most-water',
    'design-add-and-search-words-data-structure',
    'longest-increasing-subsequence',
    'spiral-matrix',
  ],
  [
    'reverse-linked-list',
    'longest-substring-without-repeating-characters',
    'number-of-islands',
    'unique-paths',
    'set-matrix-zeroes',
  ],
  [
    'reverse-bits',
    'longest-repeating-character-replacement',
    'clone-graph',
    'palindromic-substrings',
    'longest-common-subsequence',
  ],
  [
    'linked-list-cycle',
    'pacific-atlantic-water-flow',
    'maximum-product-subarray',
    'sum-of-two-integers',
    'minimum-window-substring',
  ],
  [
    'invert-binary-tree',
    'search-in-rotated-sorted-array',
    'course-schedule',
    'jump-game',
    'merge-k-sorted-lists',
  ],
  [
    'missing-number',
    'reorder-list',
    'graph-valid-tree',
    'merge-intervals',
    'binary-tree-maximum-path-sum',
  ],
  [
    'same-tree',
    'remove-nth-node-from-end-of-list',
    'number-of-connected-components-in-an-undirected-graph',
    'non-overlapping-intervals',
    'serialize-and-deserialize-binary-tree',
  ],
  [
    'meeting-rooms',
    'lowest-common-ancestor-of-a-binary-search-tree',
    'kth-smallest-element-in-a-bst',
    'insert-interval',
    'find-median-from-data-stream',
  ],
  [
    'counting-bits',
    'binary-tree-level-order-traversal',
    'house-robber-ii',
    'meeting-rooms-ii',
    'word-search-ii',
  ],
  [
    'subtree-of-another-tree',
    'construct-binary-tree-from-preorder-and-inorder-traversal',
    'longest-palindromic-substring',
    'rotate-image',
    'alien-dictionary',
  ],
] as const;

/** DaleStudy issue numbers aligned with WEEKLY_PROBLEMS.md / WEEKLY_PROBLEM_SLUGS. */
export const WEEKLY_PROBLEM_ISSUES = [
  [217, 219, 237, 240, 264],
  [218, 230, 239, 241, 251],
  [220, 232, 254, 268, 275],
  [224, 227, 245, 255, 269],
  [221, 236, 238, 256, 271],
  [222, 242, 257, 272, 282],
  [223, 243, 258, 273, 283],
  [234, 244, 259, 267, 274],
  [225, 260, 270, 284, 285],
  [226, 246, 261, 276, 286],
  [235, 247, 262, 278, 287],
  [228, 248, 263, 279, 288],
  [231, 249, 252, 277, 289],
  [233, 250, 265, 280, 290],
  [229, 253, 266, 281, 291],
] as const;

const problemWeekBySlug = new Map<string, number>();
const problemIssueBySlug = new Map<string, number>();

for (const [index, slugs] of WEEKLY_PROBLEM_SLUGS.entries()) {
  const issues = WEEKLY_PROBLEM_ISSUES[index]!;
  for (const [slugIndex, slug] of slugs.entries()) {
    problemWeekBySlug.set(slug, index + 1);
    problemIssueBySlug.set(slug, issues[slugIndex]!);
  }
}

export function getProblemWeek(slug: string): number | undefined {
  return problemWeekBySlug.get(slug);
}

export function getProblemIssue(slug: string): number | undefined {
  return problemIssueBySlug.get(slug);
}
