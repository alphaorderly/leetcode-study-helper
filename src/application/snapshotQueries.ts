import type { ExtensionSnapshot } from '../shared/contracts';

/** 현재 목록에 없는 URI로 파일 작업을 요청하면 중단합니다. */
export function requireSolution(snapshot: ExtensionSnapshot, uri: string) {
  const target = findSolution(snapshot, uri);
  if (!target) {
    throw new Error('요청한 풀이가 현재 워크스페이스에 없습니다.');
  }
  return target;
}

/** 현재 목록에서 URI와 일치하는 풀이의 소속 정보를 찾으며 없으면 undefined입니다. */
function findSolution(
  snapshot: ExtensionSnapshot,
  uri: string,
):
  | {
      rootUri: string;
      slug: string;
      week?: number;
      name: string;
      uri: string;
    }
  | undefined {
  for (const repository of snapshot.repositories) {
    for (const problem of repository.problems) {
      const solution = problem.solutions.find((item) => item.uri === uri);
      if (solution) {
        return {
          rootUri: repository.rootUri,
          slug: problem.slug,
          week: problem.week,
          name: solution.name,
          uri: solution.uri,
        };
      }
    }
  }
  return undefined;
}
