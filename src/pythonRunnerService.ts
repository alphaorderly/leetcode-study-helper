import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { PythonSolutionCandidate } from './core/types';
import type { LeetCodePythonTestData } from './leetcodeTestDataService';

const TIMEOUT_MS = 10_000;
const MAX_PROTOCOL_BYTES = 1_250_000;

interface RunnerRequest {
  mode: 'inspect' | 'run';
  source: string;
  filename: string;
  slug: string;
  entryPoint: string;
  requiredObjects: string[];
  test?: string;
  candidateId?: string;
}

interface InspectSuccess {
  ok: true;
  candidates: Array<PythonSolutionCandidate & { async?: boolean }>;
  missingObjects: string[];
}

interface RunnerFailure {
  ok: false;
  kind: string;
  message: string;
  line?: number;
  column?: number;
  case?: number;
  traceback?: string;
  missingObjects?: string[];
  stdout?: string;
  stderr?: string;
}

interface RunSuccess {
  ok: true;
  outcome: 'passed' | 'failed';
  passed: number;
  total: number;
  failedCase?: number;
  assertion?: string;
  durationMs: number;
  stdout?: string;
  stderr?: string;
}

export interface PythonInspection {
  candidates: PythonSolutionCandidate[];
  missingObjects: string[];
}

export type PythonRunResult = RunSuccess | RunnerFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResponse(value: unknown): InspectSuccess | RunnerFailure | RunSuccess {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('Python 러너 응답 형식이 올바르지 않습니다.');
  }
  return value as unknown as InspectSuccess | RunnerFailure | RunSuccess;
}

function failureMessage(failure: RunnerFailure): string {
  if (failure.kind === 'syntax' && failure.line !== undefined) {
    return `${failure.line}번째 줄 Python 문법 오류: ${failure.message}`;
  }
  return failure.message;
}

function cancellationError(): Error {
  const error = new Error('Python 실행이 취소되었습니다.');
  error.name = 'AbortError';
  return error;
}

export class PythonRunnerService implements vscode.Disposable {
  private readonly processes = new Set<ReturnType<typeof spawn>>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  async inspect(
    source: string,
    filename: string,
    slug: string,
    data: LeetCodePythonTestData,
    executable: string,
    signal?: AbortSignal,
  ): Promise<PythonInspection> {
    const response = await this.invoke(executable, path.dirname(filename), {
      mode: 'inspect',
      source,
      filename,
      slug,
      entryPoint: data.entryPoint,
      requiredObjects: data.requiredObjects,
    }, signal);
    if (!response.ok) {
      throw new Error(failureMessage(response));
    }
    if (!('candidates' in response)) {
      throw new Error('Python 풀이 후보를 분석하지 못했습니다.');
    }
    return {
      candidates: response.candidates.map(({ id, label, classLine, methodLine }) => ({
        id,
        label,
        classLine,
        methodLine,
      })),
      missingObjects: response.missingObjects,
    };
  }

  async run(
    source: string,
    filename: string,
    slug: string,
    data: LeetCodePythonTestData,
    candidateId: string,
    executable: string,
    signal?: AbortSignal,
  ): Promise<PythonRunResult> {
    const response = await this.invoke(executable, path.dirname(filename), {
      mode: 'run',
      source,
      filename,
      slug,
      entryPoint: data.entryPoint,
      requiredObjects: data.requiredObjects,
      test: data.test,
      candidateId,
    }, signal);
    if (response.ok && 'candidates' in response) {
      throw new Error('Python 러너가 실행 결과 대신 분석 결과를 반환했습니다.');
    }
    return response;
  }

  dispose(): void {
    for (const child of this.processes) {
      child.kill();
    }
    this.processes.clear();
  }

  private invoke(
    executable: string,
    cwd: string,
    request: RunnerRequest,
    signal?: AbortSignal,
  ): Promise<InspectSuccess | RunnerFailure | RunSuccess> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(cancellationError());
        return;
      }
      const runnerPath = vscode.Uri.joinPath(
        this.extensionUri,
        'resources',
        'python',
        'leetcode_runner.py',
      ).fsPath;
      const child = spawn(executable, ['-I', '-u', runnerPath], {
        cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.processes.add(child);
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finish = (action: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.processes.delete(child);
        action();
      };
      const abort = (): void => {
        child.kill();
        finish(() => reject(cancellationError()));
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error('Python 테스트가 10초 제한 시간을 초과했습니다.')));
      }, TIMEOUT_MS);
      signal?.addEventListener('abort', abort, { once: true });

      child.on('error', (error) => {
        finish(() => reject(new Error(
          `Python 실행기를 시작하지 못했습니다: ${executable}. 설정에서 경로를 확인해 주세요.`,
          { cause: error },
        )));
      });
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > MAX_PROTOCOL_BYTES) {
          child.kill();
          finish(() => reject(new Error('Python 러너 응답이 허용된 크기를 초과했습니다.')));
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
        stderrBytes += chunk.byteLength;
        if (stderrBytes > MAX_PROTOCOL_BYTES) {
          child.kill();
          finish(() => reject(new Error('Python 러너 오류 출력이 허용된 크기를 초과했습니다.')));
        }
      });
      child.on('close', (code) => {
        finish(() => {
          const stdout = Buffer.concat(stdoutChunks, stdoutBytes);
          const stderr = Buffer.concat(stderrChunks, stderrBytes);
          if (code !== 0) {
            reject(new Error(
              `Python 러너가 비정상 종료되었습니다. (${code ?? '신호'}) ${stderr.toString('utf8').trim()}`.trim(),
            ));
            return;
          }
          try {
            resolve(parseResponse(JSON.parse(stdout.toString('utf8')) as unknown));
          } catch (error) {
            reject(new Error('Python 러너 결과를 읽지 못했습니다.', { cause: error }));
          }
        });
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}
