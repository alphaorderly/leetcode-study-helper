import type {
  BlockingTrackedFile,
  SolutionSubmissionStatus,
  SubmissionFileSnapshot,
  SubmissionSummary,
} from '../../../shared/contracts';
import type { RemoteSubmissionState } from '../../github/githubSubmissionClient';

/** 로컬 풀이 상태 계산에 사용하는 파일과 index·작업 트리·충돌 경로입니다. */
interface LocalStatusInput {
  readonly files: readonly SubmissionFileSnapshot[];
  readonly indexPaths: ReadonlySet<string>;
  readonly workingPaths: ReadonlySet<string>;
  readonly conflictPaths: ReadonlySet<string>;
}

/** 로컬 상태에 원격 제출 정보와 미반영 경로를 더한 상태 계산 입력입니다. */
interface SubmissionStatusInput extends LocalStatusInput {
  readonly pendingPaths: ReadonlySet<string>;
  readonly remote: RemoteSubmissionState;
  readonly canonicalMatchingPaths?: ReadonlySet<string>;
}

/** 풀이 URI별 제출 단계와 연결된 PR 번호의 계산 결과입니다. */
export interface SubmissionStatusProjection {
  readonly statuses: ReadonlyMap<string, SolutionSubmissionStatus>;
  readonly pullRequestNumbers: ReadonlyMap<string, number>;
}

/** 작업 트리·index·충돌 경로로 로컬 제출 상태를 계산합니다. */
export function localSubmissionStatuses({
  files,
  indexPaths,
  workingPaths,
  conflictPaths,
}: LocalStatusInput): ReadonlyMap<string, SolutionSubmissionStatus> {
  return new Map(
    files.map((file) => [
      file.uri,
      localStatus(file.relativePath, indexPaths, workingPaths, conflictPaths) ?? 'unknown',
    ]),
  );
}

/** 로컬 수정, 원격 비교, PR과 공식 파일 일치 여부를 결합해 파일별 제출 상태를 계산합니다. */
export function projectSubmissionStatuses({
  files,
  indexPaths,
  workingPaths,
  conflictPaths,
  pendingPaths,
  remote,
  canonicalMatchingPaths,
}: SubmissionStatusInput): SubmissionStatusProjection {
  const statuses = new Map<string, SolutionSubmissionStatus>();
  const pullRequestNumbers = new Map<string, number>();
  const remoteByPath = new Map(remote.compareFiles.map((file) => [file.filename, file]));
  const pullRequestPaths = new Set(remote.pullRequestFiles);

  for (const file of files) {
    const local = localStatus(file.relativePath, indexPaths, workingPaths, conflictPaths);
    let status: SolutionSubmissionStatus;
    if (local) {
      status = local;
    } else if (pendingPaths.has(file.relativePath)) {
      status = 'push-needed';
    } else if (remoteByPath.has(file.relativePath) && pullRequestPaths.has(file.relativePath)) {
      status = 'pr-open';
      if (remote.activePullRequest) {
        pullRequestNumbers.set(file.uri, remote.activePullRequest.number);
      }
    } else if (remoteByPath.has(file.relativePath)) {
      status =
        remoteByPath.get(file.relativePath)?.status === 'modified' && remote.behindBy > 0
          ? 'sync-needed'
          : 'pr-needed';
    } else if (canonicalMatchingPaths?.has(file.relativePath)) {
      status = 'merged';
    } else if (remote.behindBy > 0) {
      status = 'sync-needed';
    } else {
      status = 'unknown';
    }
    statuses.set(file.uri, status);
  }
  return { statuses, pullRequestNumbers };
}

/** 파일별 상태를 화면 요약에 사용하는 제출 단계별 개수로 집계합니다. */
export function summaryForStatuses(
  statuses: ReadonlyMap<string, SolutionSubmissionStatus>,
): SubmissionSummary {
  const summary: SubmissionSummary = {
    working: 0,
    staged: 0,
    pushNeeded: 0,
    prPending: 0,
    merged: 0,
    unknown: 0,
  };
  for (const status of statuses.values()) {
    switch (status) {
      case 'working':
      case 'staged-outdated':
        summary.working += 1;
        break;
      case 'staged':
        summary.staged += 1;
        break;
      case 'push-needed':
        summary.pushNeeded += 1;
        break;
      case 'pr-needed':
      case 'pr-open':
      case 'sync-needed':
        summary.prPending += 1;
        break;
      case 'merged':
        summary.merged += 1;
        break;
      case 'checking':
      case 'conflict':
      case 'unknown':
        summary.unknown += 1;
        break;
    }
  }
  return summary;
}

/** 주차가 지정된 파일들을 모아 정확히 한 주차일 때만 반환합니다. 미지정 파일은 제외합니다. */
export function singleWeek(files: readonly SubmissionFileSnapshot[]): number | undefined {
  const weeks = new Set(
    files.map(({ week }) => week).filter((week): week is number => week !== undefined),
  );
  return weeks.size === 1 ? [...weeks][0] : undefined;
}

/**
 * 유효한 주차를 week-XX 브랜치 이름으로 변환합니다.
 * @throws 허용 범위 밖의 주차인 경우.
 */
export function weekBranchName(week: number): string {
  if (!Number.isInteger(week) || week < 1 || week > 99) {
    throw new Error('제출할 주차를 확인할 수 없습니다.');
  }
  return `week-${String(week).padStart(2, '0')}`;
}

/** week-XX 형식의 유효한 주차를 반환하며 다른 브랜치는 undefined로 처리합니다. */
export function weekFromBranch(branch: string | undefined): number | undefined {
  const match = branch?.match(/^week-(\d{2})$/);
  if (!match?.[1]) {
    return undefined;
  }
  const week = Number(match[1]);
  return week >= 1 ? week : undefined;
}

/** 커밋 메시지의 첫 줄을 다듬어 반환하며 빈 메시지는 기본 제목으로 대체합니다. */
export function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() || '커밋';
}

/** index·작업 트리·충돌 경로를 합쳐 동기화 안내에 필요한 추적 파일을 분류합니다. */
export function collectBlockingTrackedFiles(
  indexPaths: ReadonlySet<string>,
  trackedWorkingPaths: ReadonlySet<string>,
  conflictPaths: ReadonlySet<string>,
  solutionPaths: ReadonlySet<string>,
): BlockingTrackedFile[] {
  const paths = new Set([...indexPaths, ...trackedWorkingPaths, ...conflictPaths]);
  return [...paths].sort().map((relativePath) => ({
    relativePath,
    kind: solutionPaths.has(relativePath) ? 'solution' : 'other',
    state: conflictPaths.has(relativePath)
      ? 'conflict'
      : indexPaths.has(relativePath)
        ? 'staged'
        : 'modified',
  }));
}

/** 충돌, 스테이징 또는 풀이 외 추적 파일 수정이 있는지 확인합니다. */
export function trackedFilesBlockSync(files: readonly BlockingTrackedFile[]): boolean {
  return files.some(
    (file) => file.state === 'conflict' || file.state === 'staged' || file.kind === 'other',
  );
}

/** 충돌·스테이징 후 수정·스테이징·작업 변경 순으로 로컬 제출 단계를 판정합니다. */
function localStatus(
  relativePath: string,
  indexPaths: ReadonlySet<string>,
  workingPaths: ReadonlySet<string>,
  conflictPaths: ReadonlySet<string>,
): SolutionSubmissionStatus | undefined {
  if (conflictPaths.has(relativePath)) {
    return 'conflict';
  }
  if (indexPaths.has(relativePath) && workingPaths.has(relativePath)) {
    return 'staged-outdated';
  }
  if (indexPaths.has(relativePath)) {
    return 'staged';
  }
  if (workingPaths.has(relativePath)) {
    return 'working';
  }
  return undefined;
}
