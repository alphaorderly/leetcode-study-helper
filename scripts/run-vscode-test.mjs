import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const util = require('@vscode/test-electron/out/util.js');
const original = util.downloadDirToExecutablePath;

util.downloadDirToExecutablePath = (dir, platform) => {
  const resolved = original(dir, platform);
  if (existsSync(resolved)) {
    return resolved;
  }
  const fallback = path.join(path.dirname(resolved), 'Code');
  return existsSync(fallback) ? fallback : resolved;
};

const cliBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../node_modules/@vscode/test-cli/out/bin.mjs',
);
await import(pathToFileURL(cliBin).href);
