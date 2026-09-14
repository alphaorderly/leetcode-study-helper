# 리트코드 스터디 도우미

> DaleStudy 리트코드 풀이를 찾고, 작성하고, 테스트하고, 제출하는 일을 VS Code 안에서 이어갑니다.

이 확장의 목표는 [DaleStudy/leetcode-study](https://github.com/DaleStudy/leetcode-study) 스터디 저장소를 더 쉽고 빠르게 사용하는 것입니다. 75개 문제를 주차별로 탐색하고, 내 풀이 파일을 관리하고, Python 코드를 로컬에서 테스트한 뒤 주차별 PR로 제출할 수 있습니다.

[설치](#설치) · [상세 사용법 보기](USAGE.md) · [빠른 시작](#빠른-시작) · [설정](#설정)

![문제 목록과 풀이 및 제출 상태를 보여 주는 리트코드 스터디 도우미 화면](media/readme/overview.png)

## 설치

사용하는 에디터에서 **확장 프로그램** 보기를 열고 `리트코드 스터디 도우미`를 검색해 설치합니다.

- VS Code: [Visual Studio Marketplace에서 보기](https://marketplace.visualstudio.com/items?itemName=alphaorderly.leetcode-study-helper)
- Cursor·VSCodium 등 Open VSX 사용 에디터: [Open VSX에서 보기](https://open-vsx.org/extension/alphaorderly/leetcode-study-helper)

검색 결과에 바로 나타나지 않으면 정확한 확장 ID를 입력하세요.

```text
@id:alphaorderly.leetcode-study-helper
```

## 사용법

저장소 준비, 닉네임 설정, 문제 탐색, 풀이 작성, Python 테스트, 주차별 제출, 포크 동기화까지 화면별 안내는 **[USAGE.md](USAGE.md)** 를 보세요.

## 무엇이 편해지나요?

| 작업 | 확장에서 할 수 있는 일 |
| --- | --- |
| 문제 찾기 | 75개 문제를 주차·난이도·풀이 여부로 묶고 제목 검색과 미푸시 필터를 제공합니다. |
| 풀이 관리 | 닉네임에 맞는 풀이를 열고, 없으면 선택한 언어로 새 파일을 만들며, 여러 언어 풀이도 나란히 보여 줍니다. |
| 문제 확인 | 현재 풀이에 대응하는 LeetCode 본문과 예제를 사이드바에서 확인하고 문제 페이지로 이동합니다. |
| Python 테스트 | 저장하지 않은 코드와 여러 `Solution` 구현을 선택해 68개 지원 문제의 로컬 테스트를 실행합니다. |
| 제출 | 선택한 풀이만 `week-XX` 브랜치에 커밋하고 push, PR 진행 상태를 하나의 흐름으로 보여 줍니다. |
| 포크 동기화 | 안전 조건을 확인한 뒤 공식 `main`을 병합하고 `origin/main`까지 동기화합니다. |

## 대표 화면

### 현재 문제와 로컬 Python 테스트

문제 본문을 읽으면서 현재 에디터의 Python 코드를 바로 실행합니다. 같은 이름의 `Solution` 클래스나 메서드가 여러 개면 줄 번호로 실행 대상을 구분합니다.

![현재 문제의 예제와 로컬 Python 테스트 통과 결과](media/readme/python-runner.png)

### 주차별 제출

`작성 중 → 커밋 준비 → push 필요 → PR 진행 → 병합 완료` 상태를 문제 카드와 제출 탭에서 함께 확인합니다. 확장에서 직접 선택한 풀이만 커밋 대상으로 사용하며, 주차 커밋 시 `week-01` 형식의 브랜치를 자동으로 준비합니다.

![커밋 준비부터 PR까지 이어지는 주차별 제출 화면](media/readme/submission-flow.png)

## 빠른 시작

1. 에디터의 확장 프로그램 스토어에서 `리트코드 스터디 도우미`를 검색해 설치합니다.
2. [DaleStudy/leetcode-study](https://github.com/DaleStudy/leetcode-study)를 포크하고 로컬에 클론합니다.
3. `problem-categories.json`과 문제 폴더가 있는 저장소를 에디터로 엽니다.
4. 활동 표시줄에서 **리트코드 스터디 도우미** 아이콘을 선택합니다.
5. 제출 파일명에 사용하는 닉네임과 기본 언어를 입력하고 **적용**을 누릅니다.
6. 문제 카드를 눌러 기존 풀이를 열거나 새 풀이 파일을 만듭니다.
7. 풀이를 작성한 뒤 **현재 문제 보기**에서 테스트하고, **제출** 탭에서 커밋·push·PR 흐름을 진행합니다.

닉네임은 파일명의 첫 번째 점 앞부분과 대소문자까지 정확히 비교합니다. 예를 들어 `study-user`는 `study-user.py`와 일치하지만 `Study-User.py`와는 일치하지 않습니다.

설치와 원격 저장소 준비부터 필터, 카드 아이콘, 테스트 실패 확인, 주차별 제출과 포크 동기화까지는 [상세 사용법](USAGE.md)에서 화면별로 확인할 수 있습니다.

## 핵심 기능

### 문제 탐색과 풀이 파일

- `problem-categories.json`과 문제 폴더를 감지해 문제를 주차별·난이도별로 정리합니다.
- 제목 검색, 풀이 있음·없음, 미푸시 필터로 필요한 문제만 남깁니다.
- 닉네임과 기본 언어를 기준으로 기존 풀이를 열거나 새 제출 파일을 만듭니다.
- 같은 문제의 여러 언어 풀이, 다른 참여자의 무작위 풀이, Algodale 정답 링크를 제공합니다.
- 풀이 삭제와 Markdown을 제외한 제출 파일의 마지막 줄바꿈 일괄 정리를 지원합니다.

### 현재 문제와 Python 테스트

- 풀이 파일을 열면 LeetCode 문제 본문, 예제, 제약과 주제 태그를 표시합니다.
- 저장하지 않은 현재 에디터 코드도 테스트하며 여러 `Solution` 구현을 개별 선택합니다.
- `typing`, `array`, `bisect`, `collections`, `functools`, `itertools`, `heapq`, `math` 등 일반적인 LeetCode Python 환경을 먼저 import합니다.
- 실행은 신뢰된 워크스페이스에서만 가능하고 10초 후 종료되며 출력은 1MB로 제한됩니다.

테스트 데이터는 [`newfacade/LeetCodeDataset`](https://huggingface.co/datasets/newfacade/LeetCodeDataset)의 고정 리비전 `215604aeed660029df7de2fea5a4d7b6ed476a08`에서 추출했습니다. 현재 스터디 75문제 중 68문제를 지원하며, 결과는 LeetCode의 공식 실행 또는 제출 결과가 아닙니다.

### 주차별 제출과 포크 동기화

- 문제 카드에서 직접 **커밋에 추가**한 풀이만 스테이징합니다.
- 동기화된 `main`에서 주차 커밋을 만들면 `week-XX` 브랜치를 안전하게 생성하거나 기존 브랜치를 검증해 재사용합니다.
- 활성 주차의 커밋, push, 열린 PR과 병합 상태를 단일 레일 그래프로 보여 줍니다.
- 여러 주차나 풀이 외 파일이 섞이면 자동 진행하지 않고 먼저 정리할 내용을 안내합니다.
- 안전한 상태에서 공식 `main`을 병합하고 포크의 `origin/main`에 push합니다. 내 풀이만 수정된 경우에도 동기화를 시도하며, 풀이 외 변경은 제출 탭에서 되돌릴 수 있습니다.
- PR 병합 후에는 명시적인 버튼으로 `main`에 돌아와 동기화하며 주차 브랜치는 자동 삭제하지 않습니다.
- rebase, force push, 자동 stash를 사용하지 않으며 충돌 시 merge를 중단합니다.

제출 기능은 `origin`의 fetch·push URL이 동일하고 GitHub에서 `DaleStudy/leetcode-study`의 포크로 확인된 저장소에서만 활성화됩니다.

## 알아둘 점

- 워크스페이스 루트에는 유효한 `problem-categories.json`과 대응하는 문제 폴더가 하나 이상 있어야 합니다.
- 제한 모드에서는 목록 조회만 지원합니다. 파일 생성·삭제·수정, 로컬 테스트, Git 작업에는 워크스페이스 신뢰가 필요합니다.
- 새 풀이와 제출 파일은 문제 폴더 바로 아래에서 관리하며 같은 이름이나 대소문자만 다른 파일을 덮어쓰지 않습니다.
- Git 상태는 현재 브랜치의 upstream을 기준으로 계산합니다. 확인할 수 없는 정보는 추측하지 않고 `상태 확인 불가`로 표시합니다.
- 문제 본문은 LeetCode의 비공식 GraphQL API에서 불러옵니다. 네트워크 오류나 Premium 비공개 본문은 LeetCode 페이지에서 확인해야 합니다.
- 다른 참여자 풀이를 처음 열 때, Algodale 정답 링크를 열 때마다 정답 노출 여부를 확인합니다.
- `ListNode`, `TreeNode`, `Node`, `NestedInteger`처럼 문제별 구조가 필요한 Python 객체는 자동 선언하지 않습니다.

조건별 대응 방법은 [문제 해결](USAGE.md#9-문제-해결)을 참고하세요.

## 설정

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `leetcodeStudyHelper.nickname` | 빈 값 | 제출 파일에서 찾을 닉네임입니다. 영문·숫자·하이픈을 사용할 수 있으며 대소문자를 구분합니다. |
| `leetcodeStudyHelper.preferredLanguage` | `python3` | 새 풀이 파일을 만들 때 사용할 언어와 확장자입니다. |
| `leetcodeStudyHelper.pythonExecutable` | `python3` | Python 테스트에 사용할 실행 파일 또는 절대 경로입니다. |

설정은 전역으로 저장되어 다른 LeetCode Study 워크스페이스에서도 동일하게 사용됩니다.

## 로컬 개발

Node.js `24.18.0`과 Yarn Classic `1.22.22`를 사용합니다.

```sh
nvm use
yarn install
yarn compile
```

주요 검증 명령은 다음과 같습니다.

```sh
yarn format:check
yarn docs:check
yarn lint
yarn typecheck
yarn test:unit
yarn test:integration
yarn test
```

통합 테스트는 `.tmp`에 격리된 멀티 루트 워크스페이스를 만든 뒤 `@vscode/test-electron`으로 실행합니다.

### 코드 편집 규칙

`yarn format`으로 소스·테스트·개발 스크립트·웹뷰 CSS와 개발 설정을 정렬합니다.
Prettier는 100자 줄 길이, 공백 2칸, 작은따옴표, 세미콜론, 후행 쉼표와 LF를 사용합니다.
100자는 줄바꿈 기준이며 긴 문자열을 강제로 분할하지는 않습니다.
VS Code에서 권장 확장인 **Prettier - Code formatter**를 설치하면 지원 언어는 저장할 때 정렬됩니다.
`yarn test`는 포맷 검사부터 실행합니다.

데이터셋, 테스트용 풀이 원본과 생성 파일은 자동 포맷에서 제외합니다.
Python 실행기는 별도 포매터 없이 4칸 들여쓰기를 유지합니다.
`src/**/*.ts`와 `scripts/**/*.mjs`의 클래스·함수·타입·인터페이스, 생성자·메서드·접근자와
함수를 담은 변수에는 한국어 JSDoc을 작성합니다. 공개 여부와 관계없이 적용하며,
TypeScript 타입을 반복하기보다 전제조건, 부수 효과, 실패·취소 시 동작을 설명합니다.
일반 데이터 필드·상수와 익명 콜백은 각 선언의 설명이나 주변 구현으로 맥락을 전달합니다.
Python에서는 docstring을 사용합니다.

`yarn docs:check`는 TypeScript 구문 트리를 읽어 설명이 없는 선언의 파일·줄·이름을 보고합니다.
빈 주석이나 태그만 있는 주석도 실패로 처리하며 `yarn test`에 포함됩니다.
이 검사는 주석 누락을 방지하므로, 설명이 실제 동작과 일치하는지는 코드 리뷰에서 확인합니다.

### 폴더 구조

```text
src/
├── extension.ts                # 확장 활성화와 명령 등록 진입점
├── application/
│   ├── studyController.ts      # 설정과 사용자 명령 조율
│   └── sessions/              # 현재 문제 선택·실행, 저장소 갱신 수명 관리
├── domain/
│   ├── problems/              # 카탈로그 해석과 정답 링크 규칙
│   ├── solutions/             # 닉네임·언어·풀이 선택·줄 끝 보정 규칙
│   └── study/                 # 스터디 주차와 공식 문제 이슈 매핑
├── infrastructure/
│   ├── git/
│   │   ├── gitStatusService.ts # Git 상태 조회와 제출 작업 연결
│   │   ├── vscodeGit.ts       # 내장 Git 확장 API와 저장소 이벤트
│   │   ├── refRelation.ts     # HEAD와 ref의 관계 조회
│   │   └── submission/        # 제출 검증·브랜치 작업·이력 조회·상태 조립
│   ├── github/                # 인증, GitHub API와 PR 작성 링크
│   ├── leetcode/              # 문제 API와 포함된 테스트 데이터 읽기
│   ├── python/                # Python 프로세스 실행과 취소
│   └── workspace/             # 저장소 탐색과 풀이 파일 입출력
├── shared/
│   ├── contracts.ts           # 확장과 웹뷰가 공유하는 스냅샷·메시지 계약
│   └── async/                 # 버전 캐시와 지연 작업 도구
└── webview/
    ├── host/                  # VS Code 웹뷰 제공자와 메시지 중계
    ├── views/                 # 문제 목록·현재 문제·제출 화면
    ├── components/            # DOM 도구·아이콘·제출 그래프
    ├── state/                 # UI 상태 타입과 표시 조건 계산
    ├── main.ts                # 브라우저 메시지 수신과 UI 상태 복원
    └── render.ts              # 화면 영역 구성과 부분 갱신
```

단위 테스트는 `test/unit/` 아래에 소스의 영역별 경로를 따릅니다.
웹뷰 동작 테스트는 `test/webview/`, VS Code 통합 테스트는 `test/integration/`,
테스트용 저장소 원본은 `test/fixtures/`에 둡니다.
개발·검사 스크립트는 `scripts/`, 확장에 포함하는 데이터·Python 실행기는 `resources/`,
스타일·이미지는 `media/`에 둡니다.

도메인 규칙과 공통 계약은 VS Code·Node·DOM API 없이 사용합니다.
실행 흐름은 `application/`, 외부 시스템과 파일 접근은 `infrastructure/`에 추가합니다.
`webview/host/`는 확장 호스트에서, 나머지 웹뷰 코드는 브라우저에서 실행합니다.

### 주요 모듈 책임

| 영역 | 책임 |
| --- | --- |
| `StudyController` | 설정·사용자 명령 처리와 저장소·현재 문제 세션 연결 |
| `RepositoryRefreshSession`, `CurrentProblemSession` | 파일 감시와 갱신 요청 조율, 문제 로딩·Python 분석·실행 취소 |
| `GitStatusService`, `SubmissionStatusReader` | Git 이벤트·인증 관리와 로컬·원격 제출 정보 조회 |
| `SubmissionHistory`, `submissionSnapshot` | 커밋 이력 읽기와 입출력 없는 표시 상태 조립 |
| `SubmissionActions` | 제출 작업의 검증·실행 순서 |
| `SubmissionGuards`, `SubmissionBranches` | 저장소·이력 검증과 공식 main 동기화·주차 브랜치 전환 |
| `problemViewModel`, `submissionGraph` | 문제 목록의 표시 조건과 제출 단계별 DOM 생성 |

웹뷰 메시지와 스냅샷 계약은 `src/shared/contracts.ts`에 있습니다.
화면의 제출 가능 여부는 표시용 정보입니다. Git 쓰기는 네트워크 조회·브랜치 전환 후에도
실제 상태, index, HEAD와 origin을 다시 확인해야 합니다. 시점이 다른 검증을 중복으로 보고
합치지 않습니다. 현재 문제의 부분 갱신은 관련 없는 목록과 제출 입력 DOM을 교체하지 않습니다.

## VSIX 만들기

```sh
yarn package:vsix
```

모든 검사와 테스트가 성공하면 `.artifacts/leetcode-study-helper.vsix`가 생성됩니다. VS Code의 **Extensions: Install from VSIX...** 명령으로 설치할 수 있습니다.

## 라이선스

[MIT](LICENSE) 라이선스로 배포합니다. 이 프로젝트는 LeetCode 또는 DaleStudy의 공식 제품이 아닙니다.
