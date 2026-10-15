import { describe, expect, it } from 'vitest';
import {
  NO_WORKSPACE,
  classifyWorkspace,
  type FolderFacts,
} from '../../../../src/domain/workspace/classifyWorkspace';

const nested = { name: 'leetcode-study', uri: 'file:///dev/leetcode-study' };

function missing(entryNames: string[], nestedFolders = [] as (typeof nested)[]): FolderFacts {
  return { state: 'missing-catalog', entryNames, nested: nestedFolders };
}

describe('classifyWorkspace', () => {
  it('reports none when no folder is open', () => {
    expect(classifyWorkspace([])).toEqual({ kind: 'none', nestedStudyFolders: [] });
    expect(NO_WORKSPACE.kind).toBe('none');
  });

  it.each([
    ['no entries', []],
    ['only git metadata', ['.git']],
    ['only OS and editor metadata', ['.git', '.DS_Store', '.vscode', 'Thumbs.db', 'desktop.ini']],
  ])('treats a folder with %s as empty', (_name, entries) => {
    expect(classifyWorkspace([missing(entries)]).kind).toBe('empty');
  });

  it('treats a folder with real content as another project', () => {
    expect(classifyWorkspace([missing(['.git', 'package.json'])]).kind).toBe('other');
    expect(classifyWorkspace([missing(['README.md'])]).kind).toBe('other');
  });

  it('offers nested study folders and ignores them in other kinds', () => {
    expect(classifyWorkspace([missing(['leetcode-study'], [nested])])).toEqual({
      kind: 'nested',
      nestedStudyFolders: [nested],
    });
    expect(classifyWorkspace([missing(['leetcode-study'], [nested]), { state: 'study' }])).toEqual({
      kind: 'study',
      nestedStudyFolders: [],
    });
  });

  it('reports study and broken roots directly', () => {
    expect(classifyWorkspace([{ state: 'study' }]).kind).toBe('study');
    expect(classifyWorkspace([{ state: 'broken' }]).kind).toBe('broken');
  });

  it('prefers the most useful kind across roots', () => {
    const order: FolderFacts[] = [
      { state: 'study' },
      { state: 'broken' },
      missing(['leetcode-study'], [nested]),
      missing(['package.json']),
      missing([]),
    ];
    const expected = ['study', 'broken', 'nested', 'other', 'empty'];
    for (let start = 0; start < order.length; start += 1) {
      const roots = [...order.slice(start)].reverse();
      expect(classifyWorkspace(roots).kind).toBe(expected[start]);
    }
  });
});
