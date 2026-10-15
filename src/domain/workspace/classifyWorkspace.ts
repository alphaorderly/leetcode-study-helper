import type { NestedStudyFolder, WorkspaceKind, WorkspaceSnapshot } from '../../shared/contracts';

/** 첫 탐색 전이나 열린 폴더가 없을 때 쓰는 기본 분류입니다. 참조 비교를 위해 하나의 객체를 공유합니다. */
export const NO_WORKSPACE: WorkspaceSnapshot = Object.freeze({
  kind: 'none',
  nestedStudyFolders: [],
}) as WorkspaceSnapshot;

/** 폴더가 비어 있는지 판단할 때 무시하는 운영체제·에디터 생성 항목입니다. */
const IGNORED_ENTRIES: ReadonlySet<string> = new Set([
  '.git',
  '.DS_Store',
  '.vscode',
  'Thumbs.db',
  'desktop.ini',
]);

/** 스터디 저장소 후보로 보는 하위 폴더 이름입니다. 하위 폴더 전체를 스캔하지 않기 위한 휴리스틱입니다. */
export const NESTED_STUDY_FOLDER_PATTERN = /leetcode.?study/i;

/**
 * 한 워크스페이스 루트에서 파일 탐색으로 확인한 사실입니다.
 * study는 유효한 저장소, broken은 카탈로그를 읽지 못했거나 문제 폴더가 없는 경우입니다.
 * missing-catalog만 루트 항목과 하위 후보를 포함하며 이 둘로 empty, nested, other를 구분합니다.
 */
export type FolderFacts =
  | { state: 'study' }
  | { state: 'broken' }
  | {
      state: 'missing-catalog';
      entryNames: readonly string[];
      nested: readonly NestedStudyFolder[];
    };

/** 카탈로그가 없는 루트를 하위 저장소 후보, 빈 폴더, 무관한 프로젝트 순서로 분류합니다. */
function classifyMissingCatalog(
  facts: Extract<FolderFacts, { state: 'missing-catalog' }>,
): WorkspaceKind {
  if (facts.nested.length > 0) {
    return 'nested';
  }
  return facts.entryNames.some((name) => !IGNORED_ENTRIES.has(name)) ? 'other' : 'empty';
}

/** 루트 하나의 사실을 종류로 바꿉니다. */
function classifyFolder(facts: FolderFacts): WorkspaceKind {
  switch (facts.state) {
    case 'study':
      return 'study';
    case 'broken':
      return 'broken';
    case 'missing-catalog':
      return classifyMissingCatalog(facts);
  }
}

/** 여러 루트 중 안내에 가장 의미 있는 종류를 고르기 위한 우선순위입니다. 앞선 값이 이깁니다. */
const PRIORITY: readonly WorkspaceKind[] = ['study', 'broken', 'nested', 'other', 'empty', 'none'];

/**
 * 모든 워크스페이스 루트의 사실을 하나의 분류로 합칩니다. 루트가 없으면 none입니다.
 * 하위 저장소 후보는 최종 종류가 nested일 때만 노출해 다른 종류에서 오래된 후보가 남지 않게 합니다.
 */
export function classifyWorkspace(folders: readonly FolderFacts[]): WorkspaceSnapshot {
  const kinds = folders.map(classifyFolder);
  const kind = PRIORITY.find((candidate) => kinds.includes(candidate)) ?? 'none';
  const nestedStudyFolders =
    kind === 'nested'
      ? folders.flatMap((facts) => (facts.state === 'missing-catalog' ? facts.nested : []))
      : [];
  return { kind, nestedStudyFolders: [...nestedStudyFolders] };
}
