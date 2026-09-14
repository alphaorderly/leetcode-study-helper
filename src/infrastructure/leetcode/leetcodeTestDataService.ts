import * as vscode from 'vscode';

/** Python 실행기의 진입점, 테스트 코드와 필요한 객체 선언 목록입니다. */
export interface LeetCodePythonTestData {
  taskId: string;
  questionId: number;
  entryPoint: string;
  methodName: string;
  test: string;
  requiredObjects: string[];
}

/** 포함된 Python 테스트 데이터의 문제 수, 누락 목록과 slug별 테스트입니다. */
interface DatasetFile {
  problemCount: number;
  missing: string[];
  problems: Record<string, LeetCodePythonTestData>;
}

/** null과 배열을 제외한 객체인지 확인합니다. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 데이터셋과 문제별 필수 필드를 검증하고 사용할 테스트 항목만 추출합니다. */
function parseDataset(value: unknown): DatasetFile {
  if (!isRecord(value) || !isRecord(value.problems) || !Array.isArray(value.missing)) {
    throw new Error('포함된 LeetCode 테스트 데이터 형식이 올바르지 않습니다.');
  }
  const problems: Record<string, LeetCodePythonTestData> = {};
  for (const [slug, raw] of Object.entries(value.problems)) {
    if (
      !isRecord(raw) ||
      typeof raw.taskId !== 'string' ||
      typeof raw.questionId !== 'number' ||
      typeof raw.entryPoint !== 'string' ||
      typeof raw.methodName !== 'string' ||
      typeof raw.test !== 'string' ||
      !Array.isArray(raw.requiredObjects) ||
      !raw.requiredObjects.every((item) => typeof item === 'string')
    ) {
      throw new Error(`포함된 LeetCode 테스트 데이터가 올바르지 않습니다: ${slug}`);
    }
    problems[slug] = {
      taskId: raw.taskId,
      questionId: raw.questionId,
      entryPoint: raw.entryPoint,
      methodName: raw.methodName,
      test: raw.test,
      requiredObjects: raw.requiredObjects,
    };
  }
  return {
    problemCount:
      typeof value.problemCount === 'number' ? value.problemCount : Object.keys(problems).length,
    missing: value.missing.filter((item): item is string => typeof item === 'string'),
    problems,
  };
}

/**
 * 확장 리소스의 JSON 테스트 데이터를 최초 요청 때 한 번 읽는 서비스입니다.
 * 동시 요청은 같은 Promise를 공유하고 읽기·검증 실패 시 캐시를 비워 재시도합니다.
 * 문제 누락은 undefined이며 파일 자체의 손상·읽기 실패는 오류입니다. 테스트 코드는 여기서 실행하지 않습니다.
 */
export class LeetCodeTestDataService {
  private data: Promise<DatasetFile> | undefined;

  /** 확장에 포함된 테스트 데이터의 기준 URI를 보관합니다. */
  constructor(private readonly extensionUri: vscode.Uri) {}

  /** 문제에 해당하는 테스트 데이터를 반환합니다. 데이터셋에 없는 slug면 undefined입니다. */
  async getProblem(slug: string): Promise<LeetCodePythonTestData | undefined> {
    const data = await this.load();
    return data.problems[slug];
  }

  /** 동시 요청이 하나의 읽기를 공유하게 하며, 읽기에 실패하면 다음 호출에서 재시도합니다. */
  private async load(): Promise<DatasetFile> {
    if (!this.data) {
      this.data = this.read();
      void this.data.catch(() => {
        this.data = undefined;
      });
    }
    return this.data;
  }

  /** 확장 리소스의 JSON 데이터셋을 읽어 검증하며 읽기·파싱 오류는 호출자에게 전달합니다. */
  private async read(): Promise<DatasetFile> {
    const uri = vscode.Uri.joinPath(this.extensionUri, 'resources', 'leetcode-python-tests.json');
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseDataset(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  }
}
