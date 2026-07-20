import * as vscode from 'vscode';

export interface LeetCodePythonTestData {
  taskId: string;
  questionId: number;
  entryPoint: string;
  methodName: string;
  test: string;
  requiredObjects: string[];
}

interface DatasetFile {
  problemCount: number;
  missing: string[];
  problems: Record<string, LeetCodePythonTestData>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDataset(value: unknown): DatasetFile {
  if (!isRecord(value) || !isRecord(value.problems) || !Array.isArray(value.missing)) {
    throw new Error('포함된 LeetCode 테스트 데이터 형식이 올바르지 않습니다.');
  }
  const problems: Record<string, LeetCodePythonTestData> = {};
  for (const [slug, raw] of Object.entries(value.problems)) {
    if (
      !isRecord(raw)
      || typeof raw.taskId !== 'string'
      || typeof raw.questionId !== 'number'
      || typeof raw.entryPoint !== 'string'
      || typeof raw.methodName !== 'string'
      || typeof raw.test !== 'string'
      || !Array.isArray(raw.requiredObjects)
      || !raw.requiredObjects.every((item) => typeof item === 'string')
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
    problemCount: typeof value.problemCount === 'number'
      ? value.problemCount
      : Object.keys(problems).length,
    missing: value.missing.filter((item): item is string => typeof item === 'string'),
    problems,
  };
}

export class LeetCodeTestDataService {
  private data: Promise<DatasetFile> | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  async getProblem(slug: string): Promise<LeetCodePythonTestData | undefined> {
    const data = await this.load();
    return data.problems[slug];
  }

  private async load(): Promise<DatasetFile> {
    if (!this.data) {
      this.data = this.read();
      void this.data.catch(() => {
        this.data = undefined;
      });
    }
    return this.data;
  }

  private async read(): Promise<DatasetFile> {
    const uri = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'leetcode-python-tests.json',
    );
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseDataset(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  }
}
