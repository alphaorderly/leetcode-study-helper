import { defineConfig } from '@vscode/test-cli';

export const vscodeTestVersion = '1.133.0';

export default defineConfig({
  label: 'integrationTests',
  files: 'out/test/integration/**/*.test.js',
  version: vscodeTestVersion,
  workspaceFolder: './.tmp/integration.code-workspace',
  mocha: {
    ui: 'tdd',
    timeout: 20000,
  },
});
