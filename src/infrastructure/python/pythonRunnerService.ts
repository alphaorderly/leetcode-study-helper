import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { PythonSolutionCandidate } from '../../shared/contracts';
import type { LeetCodePythonTestData } from '../leetcode/leetcodeTestDataService';

const TIMEOUT_MS = 10_000;
const MAX_PROTOCOL_BYTES = 1_250_000;

/** Python 프로세스에 전달하는 분석·실행 모드, 소스와 테스트 입력입니다. */
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

/** Python 분석이 성공했을 때의 실행 후보와 누락 객체 목록입니다. */
interface InspectSuccess {
  ok: true;
  candidates: Array<PythonSolutionCandidate & { async?: boolean }>;
  missingObjects: string[];
}

/** Python 분석·실행 오류의 종류, 위치와 진단 출력입니다. */
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

/** Python 테스트의 통과·실패 집계, 실행 시간과 표준 출력입니다. */
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

/** 확장에 전달하는 Python 실행 후보와 선언이 필요한 객체 목록입니다. */
export interface PythonInspection {
  candidates: PythonSolutionCandidate[];
  missingObjects: string[];
}

/** Python 실행의 테스트 결과 또는 프로토콜로 보고된 실패입니다. */
export type PythonRunResult = RunSuccess | RunnerFailure;

/** null과 배열을 제외한 객체인지 확인합니다. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 러너 응답의 객체 여부와 ok 판별자를 확인하며 상세 필드는 호출 단계에서 구분합니다. */
function parseResponse(value: unknown): InspectSuccess | RunnerFailure | RunSuccess {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('Python 러너 응답 형식이 올바르지 않습니다.');
  }
  return value as unknown as InspectSuccess | RunnerFailure | RunSuccess;
}

/** 문법 오류에 줄 번호를 붙이며 다른 오류는 러너의 메시지를 그대로 반환합니다. */
function failureMessage(failure: RunnerFailure): string {
  if (failure.kind === 'syntax' && failure.line !== undefined) {
    return `${failure.line}번째 줄 Python 문법 오류: ${failure.message}`;
  }
  return failure.message;
}

/** 상위 세션이 일반 실패와 구분할 수 있는 AbortError를 만듭니다. */
function cancellationError(): Error {
  const error = new Error('Python 실행이 취소되었습니다.');
  error.name = 'AbortError';
  return error;
}

/** Python 하위 프로세스로 풀이를 분석·실행하고 취소, 시간 제한과 프로토콜 출력 크기를 관리합니다. */
export class PythonRunnerService implements vscode.Disposable {
  private readonly processes = new Set<ReturnType<typeof spawn>>();

  /** 포함된 Python 실행기를 찾을 확장 리소스 URI를 보관합니다. */
  constructor(private readonly extensionUri: vscode.Uri) {}

  /** 소스의 실행 후보와 누락된 객체 선언을 분석합니다. 풀이 테스트는 실행하지 않습니다. */
  async inspect(
    source: string,
    filename: string,
    slug: string,
    data: LeetCodePythonTestData,
    executable: string,
    signal?: AbortSignal,
  ): Promise<PythonInspection> {
    const response = await this.invoke(
      executable,
      path.dirname(filename),
      {
        mode: 'inspect',
        source,
        filename,
        slug,
        entryPoint: data.entryPoint,
        requiredObjects: data.requiredObjects,
      },
      signal,
    );
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

  /**
   * 선택한 후보를 포함된 데이터셋으로 실행합니다. 테스트 실패는 정상 응답의 failed 결과입니다.
   * @throws 프로세스·프로토콜 오류 또는 취소로 작업을 완료할 수 없는 경우.
   */
  async run(
    source: string,
    filename: string,
    slug: string,
    data: LeetCodePythonTestData,
    candidateId: string,
    executable: string,
    signal?: AbortSignal,
  ): Promise<PythonRunResult> {
    const response = await this.invoke(
      executable,
      path.dirname(filename),
      {
        mode: 'run',
        source,
        filename,
        slug,
        entryPoint: data.entryPoint,
        requiredObjects: data.requiredObjects,
        test: data.test,
        candidateId,
      },
      signal,
    );
    if (response.ok && 'candidates' in response) {
      throw new Error('Python 러너가 실행 결과 대신 분석 결과를 반환했습니다.');
    }
    return response;
  }

  /** 관리 중인 모든 Python 프로세스를 종료하고 추적 목록을 비웁니다. */
  dispose(): void {
    for (const child of this.processes) {
      child.kill();
    }
    this.processes.clear();
  }

  /** 요청을 stdin의 JSON으로 전달하고 응답을 읽습니다. 취소·시간 초과 시 자식 프로세스를 종료합니다. */
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

      /** 타이머·취소 구독·프로세스 추적을 정리하고 Promise를 한 번만 완료합니다. */
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
      /** 하위 프로세스를 종료하고 취소 오류로 실행 요청을 완료합니다. */
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
        finish(() =>
          reject(
            new Error(
              `Python 실행기를 시작하지 못했습니다: ${executable}. 설정에서 경로를 확인해 주세요.`,
              { cause: error },
            ),
          ),
        );
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
            reject(
              new Error(
                `Python 러너가 비정상 종료되었습니다. (${code ?? '신호'}) ${stderr.toString('utf8').trim()}`.trim(),
              ),
            );
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
