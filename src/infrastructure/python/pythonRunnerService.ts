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

/**
 * 프로토콜 응답의 최상위 객체와 ok 판별자만 확인합니다. 전체 스키마 검증은 하지 않습니다.
 * inspect/run 호출부가 응답 종류를 추가 구분하므로 형식을 바꾸면 양쪽도 함께 확인해야 합니다.
 */
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

/**
 * CurrentProblemSession이 사용하는 Python 프로세스 경계입니다. 호출마다 새 프로세스를 띄우고
 * JSON 요청을 stdin으로, 응답을 stdout으로 주고받습니다. 사용자 출력은 응답 필드 안에 있습니다.
 * 진행 중 프로세스를 소유하며 시간 초과·취소·dispose에서 종료합니다.
 * 워크스페이스 신뢰와 현재 파일 선택은 상위 세션이 확인합니다.
 */
export class PythonRunnerService implements vscode.Disposable {
  /** 이 서비스가 시작해 아직 정리하지 않은 자식 프로세스입니다. 개별 완료 시 제거하고 dispose에서 남은 프로세스를 종료합니다. */
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

  /**
   * 한 프로세스의 시작·출력 수집·응답 해석·종료를 관리합니다.
   * error, close, timeout, abort가 경쟁해도 finish가 Promise를 한 번만 완료합니다.
   * stdout은 JSON 프로토콜이므로 바이트 상한을 넘으면 일부 JSON을 파싱하지 않고 실패합니다.
   * -I는 Python 환경 격리 옵션이며 실행 허용 여부는 상위 세션이 결정합니다.
   * @throws 실행기 시작 실패, 시간·출력 한도 초과, 비정상 종료, JSON 오류 또는 AbortError.
   */
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
      /** 러너의 JSON 응답 바이트입니다. 사용자 print 출력은 JSON 안에 캡처되며 여기서는 프로토콜 응답 전체를 모읍니다. */
      const stdoutChunks: Buffer[] = [];
      /** 러너 자체의 오류 출력입니다. 비정상 종료 설명에 사용하며 stdout의 JSON 파싱과 섞지 않습니다. */
      const stderrChunks: Buffer[] = [];
      /** 청크 개수가 아닌 누적 바이트 수로 응답 상한을 검사하고 최종 Buffer 조립 크기를 지정합니다. */
      let stdoutBytes = 0;
      /** stderr도 별도 상한으로 추적해 오류 출력이 무한히 쌓이지 않도록 합니다. */
      let stderrBytes = 0;
      /** error·close·취소·시간 초과가 겹쳐도 Promise 완료와 정리를 한 번만 수행하기 위한 플래그입니다. */
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
      /** 프로세스 시작부터의 시간 제한입니다. 종료 경로는 finish를 거쳐 이 타이머와 취소 구독을 해제합니다. */
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
