import { defineConfig } from '@vscode/test-cli';

export const vscodeTestVersion = '1.133.0';

export default defineConfig({
  label: 'integrationTests',
  files: 'out/test/integration/**/*.test.js',
  version: vscodeTestVersion,
  workspaceFolder: './.tmp/integration.code-workspace',
  // GitHub 인증은 테스트용 VS Code에 내장되어 있어 마켓 설치를 건너뜁니다.
  skipExtensionDependencies: true,
  mocha: {
    ui: 'tdd',
    timeout: 20000,
  },
});
