# 사용 통계

이 통계는 확장을 개선할 개발자가 기능 사용과 제출 흐름을 분석하기 위한 것입니다.
식별자는 무작위로 만든 설치 단위의 값이며 사람 수나 GitHub 계정 수와 같지 않습니다.
동의하지 않은 사용자, 다른 도구로 수행한 작업, 전송 실패로 폐기한 이벤트는 집계에 포함되지 않습니다.

## 동의와 중단

`leetcodeStudyHelper.telemetry.enabled`의 기본값은 `false`입니다. 배포 환경에서 수집 설정을
선택하지 않은 채 사이드바를 열면 동의 모달을 표시합니다.
상세 수집 항목을 읽고 `동의`를 선택해야 수집을 켭니다.
`수집하지 않음`을 선택하거나 모달을 닫으면 전역 설정에 `false`를 저장합니다.
이미 전역 설정을 선택했다면 안내하지 않으며, 설정 항목을 삭제하면 다시 안내합니다.

사이드바 설정의 **사용 통계** 체크박스는 닉네임·언어 적용과 별도로 저장됩니다.
VS Code의 사용 통계가 꺼졌거나 errors-only 설정이면 작업 실패를 포함한 모든 사용 이벤트를
전송하지 않습니다. workspace 설정은 사용자의 전역 수집 동의를 대신할 수 없습니다.

동의 이후 만든 UUID는 확장 `globalState`에 보관하고 Settings Sync 대상에 등록하지 않습니다.
ID 저장 실패 시 해당 세션은 수집하지 않습니다. 수집을 중단하면 대기 이벤트·타이머를 버리고
요청을 취소합니다. 중단 설정 저장이 실패해도 해당 세션의 수집은 중단 상태를 유지합니다.
재동의 시 중단 전 데이터나 동의 전에 시작한 작업을 전송하지 않습니다.

## 데이터와 전송

PostHog US의 `https://us.i.posthog.com/batch/`에 공개 프로젝트 토큰으로 이벤트를 전송합니다.
사용자 프로필 생성과 위치 정보 확장을 비활성화하며 다음 속성만 허용합니다.

- 공통: 스키마 버전, 확장·에디터 버전, `environment`, 설치 식별자, UTC 발생 시각.
- 기능: 정해진 작업·결과·실패 단계·오류 분류, 밀리초 소요 시간, 후처리 실패 여부.
- 문제: 공식 76개 문제(온보딩 `to-lower-case` 포함) slug와 공식 주차(온보딩은 0), 알려진 언어. `.py`의 실제 파일 언어는 `python3`로 집계합니다.
- 제출·준비: 검증된 주차와 문제 수, PR을 연 대상 종류, 준비 기록의 정해진 단계.
- 테스트: 통과·전체 개수. 테스트 입력·출력과 실행 소스는 포함하지 않습니다.

닉네임, 코드, 파일명·경로, 저장소 URL, 브랜치·커밋 해시, PR 번호, 복구 작업 ID,
검색어·커밋 메시지, 원문 오류·traceback·stdout·stderr는 수집하지 않습니다.
타입 계약 이후에도 이벤트별 허용 목록으로 다시 구성하므로 임의 속성은 전송하지 않습니다.
자동 machine/session ID와 처리되지 않은 예외 수집도 사용하지 않습니다.
상세 속성 분류는 [telemetry.json](telemetry.json)에 있습니다.

메모리에는 전송 중인 이벤트를 포함해 최대 100개를 보관합니다. 최대 20개씩, 첫 대기 이벤트
이후 5초 또는 20개 도달 시 전송하며 요청은 직렬로 수행합니다. 요청·응답 읽기의 제한 시간은
2초입니다. 넘친 오래된 대기 이벤트와 실패한 배치는 폐기하고 재시도·디스크 보관은 하지 않습니다.
일반 종료는 유효한 동의 아래 최대 1.5초만 남은 전송을 기다립니다. 통계 오류는 학습 기능을
실패시키거나 원문 로그·알림을 만들지 않습니다.

## 이벤트

| 이벤트 | 의미와 주요 속성 |
| --- | --- |
| `study_session_started` | 수집이 허용된 첫 사이드바 세션. 당시 `setup_ready`, `preferred_language`. |
| `setup_ready` | 동의 후 유효한 설정과 지원 저장소를 처음 관측. 설치별 한 번이며 과거 설정 완료 시각은 아닙니다. |
| `solution_open_finished` | 확장 명령으로 내 풀이를 연 결과. 문제·주차·실제 파일 언어. |
| `solution_create_finished` | 파일 생성 명령 결과. `create_result: created/exists`로 새 생성과 기존 파일 열기를 구분합니다. |
| `reference_open_finished` | `reference_kind: other_solution/answer/problem`. 실제 편집기·브라우저 열기와 취소·대상 없음 구분. |
| `test_finished` | `outcome: passed/failed/error/cancelled`. 테스트 결과·취소를 Python 실행 세션에서 판단합니다. |
| `submission_action_finished` | `action: stage/unstage/commit/push/open_pr`. 단일 풀이의 stage/unstage는 문제를, 다중 파일 작업은 주차·문제 수를 포함합니다. |
| `fork_sync_finished` | 사용자가 명시적으로 실행한 포크 동기화의 결과. 다른 작업이 내부에서 수행한 동기화는 별도 사용으로 세지 않습니다. |
| `next_week_preparation_finished` | `action: prepare/continue/cancel/shelf/cleanup/conflicts/existing_week`. 준비·복구 결과와 실제 대상 기록의 단계·주차. |

탭·검색·필터, 풀이 삭제·줄 끝 보정, 자동 조회·편집기 선택·렌더링은 이벤트를 만들지 않습니다.
별칭·내부 위임·반복 콜백은 같은 tracker를 사용해 사용자 호출마다 결과를 한 번만 발행합니다.

완료 결과는 일반 작업에서 `completed/cancelled/noop/error`, 준비 작업에서는 여기에
`awaiting_recovery`를 포함합니다. 파일 생성·Git 쓰기가 완료된 뒤 화면·상태 조회·잠금 정리가
실패하면 본체 결과는 유지하고 `followup_failed` 및 `failure_stage`를 기록합니다.
기존 파일의 편집기 열기 실패는 생성 성공이 아니라 `error + create_result: exists`입니다.

PR 대상 `existing/creation_form`은 이미 있는 PR 페이지나 작성 화면을 열었다는 뜻입니다.
PR 생성·병합 완료를 뜻하지 않습니다. 준비의 원본 복원이 성공하면 `completed`와
`phase: cancelled`를 기록합니다. 보관함·충돌 편집기 열기의 완료도 준비 전체 완료와 다릅니다.
보관함에서 다른 기록을 선택하면 선택한 기록의 단계·주차를 사용합니다.

## 분석 기준

운영 대시보드는 `environment = production` 및 `schema_version = 1`로 필터링합니다.
Unique users는 `distinct_id` 기준 고유 설치 수이며 자동 세션·설정 이벤트는 활성 집계에서 제외합니다.

| 지표 | 정의 |
| --- | --- |
| 주간 활성 설치 수 | 7일 동안 `_finished` 기능 이벤트가 하나 이상 있는 고유 설치 ID. 취소·실패도 명시적인 기능 시도입니다. |
| 주간 push 성공 설치 수 | `submission_action_finished`, `action=push`, `outcome=completed`의 7일 고유 설치 수. |
| 기능별 사용률 | 해당 기능 이벤트의 고유 설치 수 ÷ 같은 기간 주간 활성 설치 수. 결과별로 나눠 사용과 성공을 구분합니다. |
| 커밋→push 전환율 | 7일 전환 기간 안에 `action=commit,outcome=completed` 후 `action=push,outcome=completed`를 수행한 설치 비율. 가능하면 같은 `study_week`로 맞춥니다. |
| 작업 실패율 | 같은 기능 시도의 `outcome=error`와 준비의 `awaiting_recovery` 비율. 취소·noop 및 `followup_failed`는 각각 별도로 표시합니다. |
| 다음 주 재사용률 | 첫 기능 이벤트가 있는 주의 고유 설치 중 다음 주에도 기능 이벤트가 있는 비율. |
| 문제·주차별 사용 | 단일 문제 작업은 `problem_slug`, 주차 제출·준비는 `study_week/source_week/target_week`로 분류합니다. |

초기 준비 상태는 첫 `study_session_started.setup_ready`와 `setup_ready`로 확인합니다.
동의 전 설정 과정은 보이지 않으므로 전체 설치자의 onboarding 완료율로 해석하지 않습니다.
전환 기간이 끝나지 않은 최근 기간과 수집 중단·재동의로 끊어진 흐름도 별도로 고려합니다.

## 운영 설정과 확인

프로젝트 **Settings → Project → Privacy → IP data capture configuration**에서
**Discard client IP data**를 켭니다. 이벤트의 `$geoip_disable: true`는 위치 정보 확장을 막고,
프로젝트 설정은 IP 저장을 막으므로 두 조건을 함께 유지합니다.

자동 검사에는 실제 전송을 포함하지 않습니다. 수동 연결 확인은 다음 명령만 사용합니다.

```sh
yarn telemetry:check
```

공용 전송기를 사용해 `telemetry_connection_test` 하나를 `environment: development`,
고정 ID `local-connection-test`로 보냅니다. HTTP 오류, 시간 초과, 유효하지 않은 응답,
`quota_limited`는 실패로 종료합니다. 성공은 요청 수락이며 수신은 프로젝트 Events 화면에서
확인합니다. 운영 통계에는 이 이벤트를 포함하지 않습니다.

개발 호스트·자동 테스트는 실제 사용 통계를 전송하지 않습니다. 배포 수집의 수명·동의
경합·스키마·전송·기능 결과는 대체 전송기를 주입한 테스트로 검증합니다.
