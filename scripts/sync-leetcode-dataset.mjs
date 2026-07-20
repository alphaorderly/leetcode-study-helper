import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DATASET = 'newfacade/LeetCodeDataset';
const REVISION = '215604aeed660029df7de2fea5a4d7b6ed476a08';
const BASE_URL = `https://huggingface.co/datasets/${DATASET}/resolve/${REVISION}`;
const SPLITS = ['LeetCodeDataset-train.jsonl', 'LeetCodeDataset-test.jsonl'];
const EXPECTED_MISSING = [
  'clone-graph',
  'design-add-and-search-words-data-structure',
  'encode-and-decode-strings',
  'find-median-from-data-stream',
  'implement-trie-prefix-tree',
  'lowest-common-ancestor-of-a-binary-search-tree',
  'serialize-and-deserialize-binary-tree',
];
const ENTRY_POINT_PATTERN = /^Solution\(\)\.([A-Za-z_]\w*)$/;

function currentSlugs(markdown) {
  return [...markdown.matchAll(/\|[^\n]*\| `([a-z0-9-]+)` \|/g)]
    .map((match) => match[1])
    .filter((slug) => slug !== undefined);
}

function requiredObjects(test) {
  const objects = [];
  if (/\blist_node\s*\(/.test(test)) {
    objects.push('ListNode');
  }
  if (/\btree_node\s*\(/.test(test)) {
    objects.push('TreeNode');
  }
  return objects;
}

async function scanSplit(filename, wanted, found) {
  const response = await globalThis.fetch(`${BASE_URL}/${filename}`);
  if (!response.ok || !response.body) {
    throw new Error(`${filename} 다운로드 실패: HTTP ${response.status}`);
  }

  const lines = createInterface({
    input: Readable.fromWeb(response.body),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const row = JSON.parse(line);
    if (!wanted.has(row.task_id)) {
      continue;
    }
    if (found.has(row.task_id)) {
      throw new Error(`데이터셋에 중복 문제가 있습니다: ${row.task_id}`);
    }
    if (!Number.isInteger(row.question_id) || typeof row.test !== 'string') {
      throw new Error(`데이터셋 행 형식이 올바르지 않습니다: ${row.task_id}`);
    }
    const entryPointMatch = typeof row.entry_point === 'string'
      ? ENTRY_POINT_PATTERN.exec(row.entry_point)
      : null;
    if (!entryPointMatch) {
      throw new Error(`지원하지 않는 엔트리포인트입니다: ${row.task_id}`);
    }
    found.set(row.task_id, {
      taskId: row.task_id,
      questionId: row.question_id,
      entryPoint: row.entry_point,
      methodName: entryPointMatch[1],
      test: row.test,
      requiredObjects: requiredObjects(row.test),
    });
  }
}

const weeklyProblems = await readFile(resolve('WEEKLY_PROBLEMS.md'), 'utf8');
const slugs = currentSlugs(weeklyProblems);
if (slugs.length !== 75 || new Set(slugs).size !== 75) {
  throw new Error(`현재 문제 슬러그는 중복 없이 75개여야 합니다. 발견: ${slugs.length}`);
}

const wanted = new Set(slugs);
const found = new Map();
for (const split of SPLITS) {
  await scanSplit(split, wanted, found);
}

const missing = slugs.filter((slug) => !found.has(slug)).sort();
if (JSON.stringify(missing) !== JSON.stringify(EXPECTED_MISSING)) {
  throw new Error(`예상하지 못한 누락 문제: ${missing.join(', ') || '(없음)'}`);
}

const problems = Object.fromEntries(
  [...found.entries()].sort(([left], [right]) => left.localeCompare(right)),
);
const output = {
  source: {
    dataset: DATASET,
    revision: REVISION,
    license: 'apache-2.0',
    url: `https://huggingface.co/datasets/${DATASET}`,
  },
  problemCount: Object.keys(problems).length,
  missing,
  problems,
};

await mkdir(resolve('resources'), { recursive: true });
await writeFile(
  resolve('resources/leetcode-python-tests.json'),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(`LeetCodeDataset 동기화 완료: ${output.problemCount}개, 누락 ${missing.length}개`);
