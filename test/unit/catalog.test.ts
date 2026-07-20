import { describe, expect, it } from 'vitest';
import { parseProblemCatalog } from '../../src/core/catalog';

describe('parseProblemCatalog', () => {
  it('normalizes supported metadata', () => {
    const catalog = parseProblemCatalog(
      JSON.stringify({
        'two-sum': {
          difficulty: 'Easy',
          categories: ['Array', 'Hash Table'],
          blindCategories: ['Array'],
          intended_approach: 'Use a hash map.',
        },
      }),
    );

    expect(catalog['two-sum']).toEqual({
      difficulty: 'Easy',
      categories: ['Array', 'Hash Table'],
      blindCategories: ['Array'],
      intendedApproach: 'Use a hash map.',
    });
  });

  it('rejects invalid and empty catalogs', () => {
    expect(() => parseProblemCatalog('{')).toThrow('올바른 JSON 형식이 아닙니다');
    expect(() => parseProblemCatalog('[]')).toThrow('최상위 값은 객체여야 합니다');
    expect(() => parseProblemCatalog('{}')).toThrow('문제가 없습니다');
  });

  it('rejects a slug that can escape the repository root', () => {
    expect(() =>
      parseProblemCatalog(JSON.stringify({ '../outside': { difficulty: 'Hard' } })),
    ).toThrow('올바르지 않은 문제 슬러그');
  });
});
