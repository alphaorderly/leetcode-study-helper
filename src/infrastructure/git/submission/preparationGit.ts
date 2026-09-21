import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Git 실행 오류에 종료 코드와 stderr를 유지합니다. */
export class PreparationGitError extends Error {
  /** 실행 실패 정보를 보관합니다. */
  constructor(
    message: string,
    readonly code: number | string | undefined,
  ) {
    super(message);
  }
}

/** VS Code의 Git 실행 파일을 인자 배열로 호출합니다. 쉘과 gh를 사용하지 않습니다. */
export class PreparationGit {
  /** 저장소 경로와 검증된 실행 파일을 보관합니다. */
  constructor(
    readonly root: string,
    private readonly executable: string,
  ) {}

  /** 바이너리 파일과 NUL 경로를 손실 없이 읽으며 입력을 stdin으로 전달합니다. */
  async run(args: string[], input?: Buffer | string, env: NodeJS.ProcessEnv = {}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.executable,
        [...(args[0] === 'stash' ? [] : ['--literal-pathspecs']), ...args],
        {
          cwd: this.root,
          encoding: 'buffer',
          maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
        },
        (error, stdout, stderr) => {
          if (error)
            reject(new PreparationGitError(stderr.toString().trim() || error.message, error.code));
          else resolve(stdout);
        },
      );
      child.stdin?.on('error', () => {
        /* Process callback reports broken pipes. */
      });
      child.stdin?.end(input);
    });
  }

  /** ref와 상태 등 줄 단위 출력을 읽습니다. */
  async text(args: string[]): Promise<string> {
    return (await this.run(args)).toString().trim();
  }

  /** 존재하지 않는 ref만 undefined로 반환하고 다른 실패는 숨기지 않습니다. */
  async ref(ref: string): Promise<string | undefined> {
    try {
      return await this.text(['rev-parse', '--verify', `${ref}^{commit}`]);
    } catch (error) {
      if (error instanceof PreparationGitError && error.code === 128) return undefined;
      throw error;
    }
  }

  /** linked worktree도 고유한 Git 메타데이터 디렉터리를 사용합니다. */
  async directory(): Promise<string> {
    return this.text(['rev-parse', '--absolute-git-dir']);
  }

  /** 파일 목록을 NUL 구분자로 읽습니다. */
  async paths(args: string[]): Promise<string[]> {
    return (await this.run(args)).toString().split('\0').filter(Boolean);
  }

  /** 모든 비ignored 파일의 최종 내용을 별도 index에 기록하며 실제 index는 변경하지 않습니다. */
  async tree(): Promise<string> {
    const index = path.join(await this.directory(), `study-index-${randomUUID()}`);
    const env = { GIT_INDEX_FILE: index };
    try {
      await this.run(['read-tree', 'HEAD'], undefined, env);
      await this.run(['add', '-A', '--', '.'], undefined, env);
      return (await this.run(['write-tree'], undefined, env)).toString().trim();
    } finally {
      await fs.rm(index, { force: true });
      await fs.rm(`${index}.lock`, { force: true });
    }
  }

  /** 작업 트리 내용과 실제 index를 함께 비교하여 미리보기 이후 변경을 감지합니다. */
  async fingerprint(): Promise<string> {
    const hash = createHash('sha256');
    hash.update(await this.text(['rev-parse', 'HEAD']));
    hash.update(await this.text(['symbolic-ref', '--short', 'HEAD']));
    hash.update(await this.tree());
    hash.update(await this.run(['ls-files', '--stage', '-z']));
    return hash.digest('hex');
  }

  /** 내부 보관 커밋은 사용자 설정 없이 생성하며 원본 파일 모드와 바이너리를 보존합니다. */
  async commitTree(tree: string, parent: string): Promise<string> {
    return (
      await this.run(['commit-tree', tree, '-p', parent], 'LeetCode study preparation backup\n', {
        GIT_AUTHOR_NAME: 'LeetCode Study Helper',
        GIT_AUTHOR_EMAIL: 'backup@localhost',
        GIT_COMMITTER_NAME: 'LeetCode Study Helper',
        GIT_COMMITTER_EMAIL: 'backup@localhost',
      })
    )
      .toString()
      .trim();
  }

  /** 경로가 저장소 내부이며 .git 또는 symlink 부모를 통하지 않는지 검사합니다. */
  async validatePath(relativePath: string): Promise<string> {
    if (
      !relativePath ||
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some((p) => p === '..' || p.toLowerCase() === '.git')
    ) {
      throw new Error('저장소 내부 파일만 선택할 수 있습니다.');
    }
    const full = path.resolve(this.root, relativePath);
    if (!full.startsWith(`${path.resolve(this.root)}${path.sep}`))
      throw new Error('잘못된 파일 경로입니다.');
    let parent = path.dirname(full);
    while (parent !== path.resolve(this.root)) {
      try {
        if ((await fs.lstat(parent)).isSymbolicLink())
          throw new Error('심볼릭 링크 폴더는 복원할 수 없습니다.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      parent = path.dirname(parent);
    }
    return full;
  }
}
