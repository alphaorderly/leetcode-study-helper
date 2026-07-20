import type { ProblemCatalog, ProblemMetadata } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseMetadata(value: unknown): ProblemMetadata {
  if (!isRecord(value)) {
    throw new Error('각 문제 항목은 객체여야 합니다.');
  }

  return {
    difficulty: typeof value.difficulty === 'string' ? value.difficulty : 'Unknown',
    categories: strings(value.categories),
    blindCategories: strings(value.blindCategories),
    intendedApproach:
      typeof value.intended_approach === 'string' ? value.intended_approach : undefined,
  };
}

export function parseProblemCatalog(contents: string): ProblemCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    throw new Error('problem-categories.json이 올바른 JSON 형식이 아닙니다.');
  }

  if (!isRecord(parsed)) {
    throw new Error('problem-categories.json의 최상위 값은 객체여야 합니다.');
  }

  const catalog: ProblemCatalog = {};
  for (const [slug, metadata] of Object.entries(parsed)) {
    if (!slug || slug.includes('/') || slug.includes('\\')) {
      throw new Error(`올바르지 않은 문제 슬러그입니다: ${slug || '(비어 있음)'}`);
    }
    catalog[slug] = parseMetadata(metadata);
  }

  if (Object.keys(catalog).length === 0) {
    throw new Error('problem-categories.json에 문제가 없습니다.');
  }

  return catalog;
}
