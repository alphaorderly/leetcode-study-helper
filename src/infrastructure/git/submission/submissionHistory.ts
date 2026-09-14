import type {
  LocalSubmissionHistorySnapshot,
  SubmissionCommitSnapshot,
  SubmissionFileSnapshot,
} from '../../../shared/contracts';
import { type GitHubCompareCommit } from '../../github/githubSubmissionClient';
import { firstLine } from './submissionModel';
import {
  addRelativeChangePaths,
  upstreamRef,
  type GitCommit,
  type GitRepository,
} from '../vscodeGit';

/** 커밋과 변경 파일을 읽어 표시용 이력을 만듭니다. 조회 실패를 빈 성공 결과로 숨기지 않습니다. */
export class SubmissionHistory {
  /**
   * upstream 또는 공식 main과의 공통 조상 이후 로컬 커밋을 조회합니다.
   * 기준 ref나 변경 파일을 확인할 수 없으면 unavailable 사유를 보존합니다.
   */
  async getLocalPendingCommits(
    repository: GitRepository,
    fileByPath: ReadonlyMap<string, SubmissionFileSnapshot>,
    currentBranchWeek: number | undefined,
    canonicalRemoteName: string | undefined,
  ): Promise<{
    commits: SubmissionCommitSnapshot[];
    history: LocalSubmissionHistorySnapshot;
  }> {
    const upstream = repository.state.HEAD?.upstream;
    const usedLocalMainFallback =
      !upstream && currentBranchWeek !== undefined && canonicalRemoteName === undefined;
    const ref = upstream
      ? upstreamRef(upstream)
      : currentBranchWeek !== undefined
        ? canonicalRemoteName
          ? `${canonicalRemoteName}/main`
          : 'main'
        : undefined;
    if (!ref) {
      return {
        commits: [],
        history: { status: 'ready' },
      };
    }
    try {
      const mergeBase = await repository.getMergeBase('HEAD', ref);
      if (!mergeBase) {
        throw new Error(`${ref}와 현재 브랜치의 공통 기준점을 찾을 수 없습니다.`);
      }
      const commits = await repository.log({
        range: `${mergeBase}..HEAD`,
        reverse: true,
        maxEntries: 51,
      });
      if (commits.length > 50) {
        throw new Error('로컬 제출 커밋이 너무 많아 화면에 안전하게 표시할 수 없습니다.');
      }
      const snapshots = await Promise.all(
        commits.map((commit) => this.toCommitSnapshot(repository, commit, false, fileByPath)),
      );
      return {
        commits: snapshots.filter(
          ({ files, otherFiles, fileInspectionStatus }) =>
            files.length > 0 || otherFiles.length > 0 || fileInspectionStatus === 'unavailable',
        ),
        history: {
          status: 'ready',
          baseRef: ref,
          mergeBase,
          usedLocalMainFallback,
          reason: usedLocalMainFallback
            ? '공식 remote가 없어 로컬 main의 merge-base를 사용했습니다.'
            : undefined,
        },
      };
    } catch (error) {
      return {
        commits: [],
        history: {
          status: 'unavailable',
          baseRef: ref,
          usedLocalMainFallback,
          reason:
            error instanceof Error
              ? `로컬 커밋 기록을 확인할 수 없습니다: ${error.message}`
              : '로컬 커밋 기록을 확인할 수 없습니다.',
        },
      };
    }
  }

  /** 로컬에서 읽을 수 있는 원격 커밋을 표시용 이력으로 만듭니다. 없는 커밋의 파일은 origin 목록에 남습니다. */
  async getRemoteCommits(
    repository: GitRepository,
    commits: readonly GitHubCompareCommit[],
    remotePaths: ReadonlySet<string>,
    fileByPath: ReadonlyMap<string, SubmissionFileSnapshot>,
  ): Promise<SubmissionCommitSnapshot[]> {
    const snapshots: SubmissionCommitSnapshot[] = [];
    for (const item of commits) {
      try {
        const commit = await repository.getCommit(item.sha);
        const snapshot = await this.toCommitSnapshot(
          repository,
          commit,
          true,
          fileByPath,
          remotePaths,
        );
        if (
          snapshot.files.length > 0 ||
          snapshot.otherFiles.length > 0 ||
          snapshot.fileInspectionStatus === 'unavailable'
        ) {
          snapshots.push(snapshot);
        }
      } catch {
        // A remote commit may not exist locally yet. The origin node still lists its files.
      }
    }
    return snapshots;
  }

  /** 커밋의 첫 부모와 비교해 풀이·기타 파일을 분류하고 조회 실패를 별도 상태로 표시합니다. */
  private async toCommitSnapshot(
    repository: GitRepository,
    commit: GitCommit,
    pushed: boolean,
    fileByPath: ReadonlyMap<string, SubmissionFileSnapshot>,
    includePaths?: ReadonlySet<string>,
  ): Promise<SubmissionCommitSnapshot> {
    const paths = new Set<string>();
    const parent = commit.parents[0];
    if (!parent) {
      return {
        hash: commit.hash,
        shortHash: commit.hash.slice(0, 7),
        message: firstLine(commit.message),
        pushed,
        files: [],
        otherFiles: [],
        fileInspectionStatus: 'unavailable',
        fileInspectionReason: '부모 커밋이 없어 변경 파일을 확인할 수 없습니다.',
      };
    }
    try {
      addRelativeChangePaths(
        paths,
        repository.rootUri,
        await repository.diffBetween(parent, commit.hash),
      );
    } catch (error) {
      return {
        hash: commit.hash,
        shortHash: commit.hash.slice(0, 7),
        message: firstLine(commit.message),
        pushed,
        files: [],
        otherFiles: [],
        fileInspectionStatus: 'unavailable',
        fileInspectionReason:
          error instanceof Error
            ? `변경 파일을 확인할 수 없습니다: ${error.message}`
            : '변경 파일을 확인할 수 없습니다.',
      };
    }
    const included = [...paths].filter(
      (relativePath) => !includePaths || includePaths.has(relativePath),
    );
    return {
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 7),
      message: firstLine(commit.message),
      pushed,
      files: included.flatMap((relativePath) => {
        const file = fileByPath.get(relativePath);
        return file ? [file] : [];
      }),
      otherFiles: included.filter((relativePath) => !fileByPath.has(relativePath)),
      fileInspectionStatus: 'ready',
    };
  }
}
