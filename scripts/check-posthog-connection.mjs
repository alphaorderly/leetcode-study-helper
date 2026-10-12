/**
 * 명시적으로 실행할 때 개발용 이벤트 하나를 보내 PostHog 연결을 확인합니다.
 * 고정된 테스트 ID만 사용하며 사용자·풀이·저장소 정보는 보내지 않습니다.
 * 공용 HTTP 전송기를 메모리에 번들해 재사용합니다. 확장 활성화나 일반 검사에서는 실행하지 않습니다.
 */
import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL('../src/infrastructure/telemetry/posthogHttp.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  logLevel: 'silent',
});
const { sendPostHogBatch } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

try {
  const result = await sendPostHogBatch(
    [
      {
        distinct_id: 'local-connection-test',
        event: 'telemetry_connection_test',
        timestamp: new Date().toISOString(),
        properties: {
          environment: 'development',
          $process_person_profile: false,
          $geoip_disable: true,
        },
      },
    ],
    new globalThis.AbortController().signal,
  );
  if (result !== 'accepted') {
    console.error(`PostHog 연결 테스트 실패: ${result}`);
    process.exitCode = 1;
  } else {
    console.log('PostHog 연결 테스트 이벤트의 전송 요청이 수락되었습니다.');
  }
} catch {
  console.error('PostHog 연결 테스트 실패: 프로젝트 토큰, 수집 주소와 네트워크를 확인해 주세요.');
  process.exitCode = 1;
}
