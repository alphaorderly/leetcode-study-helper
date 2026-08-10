import type {
  SolutionSubmissionStatus,
  SubmissionFileSnapshot,
  SubmissionSummary,
} from '../core/types';
import type { RemoteSubmissionState } from './githubSubmissionClient';

interface LocalStatusInput {
  readonly files: readonly SubmissionFileSnapshot[];
  readonly indexPaths: ReadonlySet<string>;
  readonly workingPaths: ReadonlySet<string>;
  readonly conflictPaths: ReadonlySet<string>;
}

interface SubmissionStatusInput extends LocalStatusInput {
  readonly pendingPaths: ReadonlySet<string>;
  readonly remote: RemoteSubmissionState;
}

export interface SubmissionStatusProjection {
  readonly statuses: ReadonlyMap<string, SolutionSubmissionStatus>;
  readonly pullRequestNumbers: ReadonlyMap<string, number>;
}

export function localSubmissionStatuses({
  files,
  indexPaths,
  workingPaths,
  conflictPaths,
}: LocalStatusInput): ReadonlyMap<string, SolutionSubmissionStatus> {
  return new Map(files.map((file) => [
    file.uri,
    localStatus(file.relativePath, indexPaths, workingPaths, conflictPaths)
      ?? 'unknown',
  ]));
}

export function projectSubmissionStatuses({
  files,
  indexPaths,
  workingPaths,
  conflictPaths,
  pendingPaths,
  remote,
}: SubmissionStatusInput): SubmissionStatusProjection {
  const statuses = new Map<string, SolutionSubmissionStatus>();
  const pullRequestNumbers = new Map<string, number>();
  const remoteByPath = new Map(
    remote.compareFiles.map((file) => [file.filename, file]),
  );
  const pullRequestPaths = new Set(remote.pullRequestFiles);

  for (const file of files) {
    const local = localStatus(
      file.relativePath,
      indexPaths,
      workingPaths,
      conflictPaths,
    );
    let status: SolutionSubmissionStatus;
    if (local) {
      status = local;
    } else if (pendingPaths.has(file.relativePath)) {
      status = 'push-needed';
    } else if (
      remoteByPath.has(file.relativePath)
      && pullRequestPaths.has(file.relativePath)
    ) {
      status = 'pr-open';
      if (remote.activePullRequest) {
        pullRequestNumbers.set(file.uri, remote.activePullRequest.number);
      }
    } else if (remoteByPath.has(file.relativePath)) {
      status =
        remoteByPath.get(file.relativePath)?.status === 'modified'
          && remote.behindBy > 0
          ? 'sync-needed'
          : 'pr-needed';
    } else if (remote.canonicalFilePaths?.has(file.relativePath)) {
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

export function singleWeek(
  files: readonly SubmissionFileSnapshot[],
): number | undefined {
  const weeks = new Set(files.map(({ week }) => week).filter(
    (week): week is number => week !== undefined,
  ));
  return weeks.size === 1 ? [...weeks][0] : undefined;
}

export function weekBranchName(week: number): string {
  if (!Number.isInteger(week) || week < 1 || week > 99) {
    throw new Error('제출할 주차를 확인할 수 없습니다.');
  }
  return `week-${String(week).padStart(2, '0')}`;
}

export function weekFromBranch(branch: string | undefined): number | undefined {
  const match = branch?.match(/^week-(\d{2})$/);
  if (!match?.[1]) {
    return undefined;
  }
  const week = Number(match[1]);
  return week >= 1 ? week : undefined;
}

export function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() || '커밋';
}

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
