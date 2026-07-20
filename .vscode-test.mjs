import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  label: 'integrationTests',
  files: 'out/test/integration/**/*.test.js',
  version: 'stable',
  workspaceFolder: './.tmp/integration.code-workspace',
  mocha: {
    ui: 'tdd',
    timeout: 20000,
  },
});
