import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('vscode');
});

describe('PythonRunnerService cancellation', () => {
  it('kills a running Python process when its signal is aborted', async () => {
    vi.doMock('vscode', () => ({
      Uri: {
        joinPath: (_root: unknown, ...segments: string[]) => ({
          fsPath: `${process.cwd()}/${segments.join('/')}`,
        }),
      },
    }));
    const { PythonRunnerService } = await import('../../src/pythonRunnerService.js');
    const service = new PythonRunnerService({} as never);
    const controller = new AbortController();
    const running = service.run(
      [
        'class Solution:',
        '    def answer(self):',
        '        while True:',
        '            pass',
      ].join('\n'),
      '/tmp/solution.py',
      'sample',
      {
        taskId: 'sample',
        questionId: 0,
        entryPoint: 'Solution().answer',
        methodName: 'answer',
        requiredObjects: [],
        test: 'def check(candidate):\n    candidate()\n',
      },
      'c0m0',
      'python3',
      controller.signal,
    );

    setTimeout(() => controller.abort(), 50);
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    service.dispose();
  });
});
