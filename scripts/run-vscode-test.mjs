/**
 * 테스트용 VS Code 배포본에서 예상 실행 파일이 없을 때 같은 디렉터리의 Code를 대체 경로로 씁니다.
 * 보정은 현재 Node 프로세스의 테스트 라이브러리에만 적용하며 설치 파일을 수정하지 않습니다.
 * 이후 CLI를 import해 별도 VS Code 통합 테스트 호스트를 시작합니다.
 */
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
