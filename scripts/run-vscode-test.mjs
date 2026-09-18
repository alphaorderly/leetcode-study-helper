/**
 * 맥에서 테스트용 VS Code zip은 unzip 대신 ditto로 풀어 앱 서명을 유지합니다.
 * 워크스페이스 안의 Electron은 SIGKILL 되므로 맥 캐시는 임시 디렉터리에 두고,
 * Electron 경로가 없으면 Code를 쓰며 Cursor 호스트 환경 변수를 지운 뒤 테스트 CLI를 시작합니다.
 */
import { createRequire } from 'node:module';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { vscodeTestVersion } from '../.vscode-test.mjs';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const download = require('@vscode/test-electron/out/download.js');
const util = require('@vscode/test-electron/out/util.js');
const originalSpawn = childProcess.spawn;
const originalDownloadDirToExecutablePath = util.downloadDirToExecutablePath;
const hostEditorEnvironment = /^(?:VSCODE_|ELECTRON_|CURSOR_)/;

/**
 * 맥에서는 워크스페이스 경로의 Electron 실행이 SIGKILL 되므로 임시 디렉터리 캐시를 씁니다.
 * Linux CI는 프로젝트 `.vscode-test`를 그대로 사용합니다.
 * @returns 테스트용 VS Code 다운로드 디렉터리입니다.
 */
function testVSCodeCachePath() {
  if (process.platform === 'darwin') {
    // os.tmpdir()는 맥에서 소켓 경로가 104자를 넘어 VS Code가 뜨지 않습니다.
    return '/tmp/leetcode-study-helper-vscode-test';
  }
  return download.defaultCachePath;
}

/**
 * 맥 zip 압축 해제를 ditto로 바꿔 테스트용 VS Code 앱 서명이 깨지지 않게 합니다.
 * unzip으로 풀면 봉인된 리소스가 무효가 되어 테스트 호스트가 SIGKILL로 종료됩니다.
 * @param command 원래 실행할 명령입니다.
 * @param args 명령 인자입니다. unzip -q archive -d dest 형태일 때만 치환합니다.
 * @param options spawn 옵션입니다.
 * @returns 자식 프로세스입니다.
 */
function spawnPreservingMacAppSignature(command, args, options, ...rest) {
  if (command === 'unzip' && Array.isArray(args) && args[0] === '-q') {
    const destinationIndex = args.indexOf('-d');
    if (destinationIndex !== -1) {
      return originalSpawn.call(
        this,
        'ditto',
        ['-x', '-k', args[1], args[destinationIndex + 1]],
        options,
        ...rest,
      );
    }
  }
  return originalSpawn.call(this, command, args, options, ...rest);
}

/**
 * 다운로드한 VS Code 경로가 Electron이 아니라 Code 바이너리만 있을 때 그 경로를 반환합니다.
 * 서명된 앱 번들에 파일을 추가하지 않고 실행 경로만 바꿉니다.
 * @param dir 버전별 VS Code 다운로드 디렉터리입니다.
 * @param platform 테스트 라이브러리가 전달하는 다운로드 플랫폼 식별자입니다.
 * @returns 실제로 존재하는 실행 파일 경로입니다. 대체 파일도 없으면 원래 경로를 유지합니다.
 */
function downloadDirToExecutablePath(dir, platform) {
  const resolved = originalDownloadDirToExecutablePath(dir, platform);
  if (existsSync(resolved)) {
    return resolved;
  }
  const fallback = path.join(path.dirname(resolved), 'Code');
  return existsSync(fallback) ? fallback : resolved;
}

/**
 * 서명이 깨진 맥 테스트용 VS Code 설치를 지워 ditto로 다시 받게 합니다.
 * 현재 설정 버전만 대상으로 하며 다른 캐시는 건드리지 않습니다.
 */
function removeBrokenMacTestInstall() {
  if (process.platform !== 'darwin') {
    return;
  }
  const installDir = path.join(
    testVSCodeCachePath(),
    `vscode-${util.systemDefaultPlatform}-${vscodeTestVersion}`,
  );
  const appPath = path.join(installDir, 'Visual Studio Code.app');
  if (!existsSync(appPath)) {
    return;
  }
  const verify = childProcess.spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    encoding: 'utf8',
  });
  if (verify.status !== 0) {
    rmSync(installDir, { recursive: true, force: true });
  }
}

/**
 * 호스트 편집기의 IPC 훅과 Electron 실행 플래그를 지워 테스트용 VS Code가 호스트 CLI에 붙지 않게 합니다.
 * Cursor에서 돌리면 `code --install-extension`이 호스트로 전달되어 내장 확장 설치가 실패합니다.
 */
function clearHostEditorEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (hostEditorEnvironment.test(key)) {
      delete process.env[key];
    }
  }
}

download.defaultCachePath = testVSCodeCachePath();
childProcess.spawn = spawnPreservingMacAppSignature;
util.downloadDirToExecutablePath = downloadDirToExecutablePath;
removeBrokenMacTestInstall();
clearHostEditorEnvironment();

const cliBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../node_modules/@vscode/test-cli/out/bin.mjs',
);
await import(pathToFileURL(cliBin).href);
