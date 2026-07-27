# 리트코드 스터디 도우미

> Find, open, test, and manage your DaleStudy LeetCode solutions without leaving VS Code.

이 확장의 목표는 [DaleStudy/leetcode-study](https://github.com/DaleStudy/leetcode-study) 스터디 저장소에서 문제 탐색, 풀이 파일 관리와 로컬 테스트를 더 쉽고 빠르게 만드는 것입니다. 내 풀이를 바로 찾고, 아직 풀지 않은 문제의 제출 파일을 VS Code 안에서 만들 수 있습니다.

![문제 목록과 풀이 및 Git 상태를 보여 주는 리트코드 스터디 도우미 화면](media/readme/overview.png)

## 핵심 기능

- `problem-categories.json`과 문제 폴더를 감지해 75개 문제를 주차별·난이도별로 정리합니다.
- 닉네임을 기준으로 내 풀이만 찾아 열고, 풀이가 없으면 선택한 언어의 빈 제출 파일을 만듭니다.
- 문제별 **다른 사람 풀이** 버튼으로 다른 참여자의 풀이를 무작위로 열어 비교합니다.
- 각 문제의 `README.md`에 등록된 Algodale 풀이·해설 링크를 책 아이콘으로 열 수 있으며, 이동 전에는 매번 정답 노출 여부를 확인합니다.
- 현재 브랜치의 upstream을 기준으로 풀이별 `origin` 또는 `push 되지 않음` 상태를 표시하고 미푸시 풀이만 모아 봅니다.
- 공식 저장소의 포크에서는 변경한 풀이를 개별 스테이징하고, 주차별 커밋·push·PR 진행 상태를 단일 레일 그래프로 확인합니다.
- 안전 조건을 만족하면 공식 `main`을 병합해 포크와 `origin/main`을 한 번에 동기화합니다.
- 풀이 파일을 열면 LeetCode 문제 본문을 사이드바에서 확인하고 문제 페이지로 바로 이동할 수 있습니다.
- 저장하지 않은 현재 Python 코드도 로컬에서 테스트하며, 같은 파일의 여러 `Solution` 구현을 각각 선택할 수 있습니다.
- 멀티 루트 워크스페이스와 파일·Git 변경 자동 갱신을 지원하며, 풀이 삭제와 파일 끝 줄바꿈 일괄 정리도 제공합니다.

## 빠른 시작

1. `problem-categories.json`과 문제 폴더가 있는 스터디 저장소를 VS Code로 엽니다.
2. 활동 표시줄에서 **리트코드 스터디 도우미** 아이콘을 선택합니다.
3. 닉네임과 기본 언어를 입력하고 **적용**을 누릅니다.
4. 문제 카드를 눌러 기존 풀이를 열거나 새 풀이 파일을 만듭니다.
5. 풀이 파일을 연 뒤 **현재 문제 보기**에서 문제 설명과 로컬 테스트를 확인합니다.
6. 변경한 풀이의 **커밋에 추가** 버튼을 누른 뒤 **제출** 탭에서 커밋, push, PR 작성을 진행합니다.

닉네임은 파일명의 첫 번째 점 앞부분과 대소문자까지 정확히 비교합니다. 예를 들어 `study-user`는 `study-user.py`와 일치하지만 `Study-User.py`와는 일치하지 않습니다.

## 현재 문제와 로컬 Python 테스트

![현재 문제의 예제와 로컬 Python 테스트 통과 결과](media/readme/python-runner.png)

테스트 러너는 저장 여부와 관계없이 현재 에디터에 보이는 Python 코드를 사용합니다. 같은 이름의 `Solution` 클래스나 대상 메서드가 여러 번 있어도 줄 번호로 구분해 실행할 구현을 선택할 수 있습니다.

`typing`, `array`, `bisect`, `collections`, `functools`, `itertools`, `heapq`, `math` 등 일반적인 LeetCode Python 환경의 라이브러리는 러너가 먼저 import합니다. `ListNode`, `TreeNode`, `Node`, `NestedInteger`처럼 문제별 구조가 필요한 객체는 자동으로 선언하지 않으며, 실제로 필요한 이름이 없으면 실행 전에 안내합니다.

테스트 데이터는 [`newfacade/LeetCodeDataset`](https://huggingface.co/datasets/newfacade/LeetCodeDataset)의 고정 리비전 `215604aeed660029df7de2fea5a4d7b6ed476a08`에서 추출했습니다. 현재 스터디 75문제 중 68문제를 지원하며, 결과는 LeetCode의 공식 실행 또는 제출 결과가 아닙니다.

실행은 신뢰된 워크스페이스에서만 가능하고 10초 후 종료되며 출력은 1MB로 제한됩니다. 별도의 OS 보안 샌드박스가 아니므로 신뢰하는 코드만 실행하세요. 기본 실행기는 `python3`이며 설정에서 다른 실행 파일이나 절대 경로를 지정할 수 있습니다.

## 주차별 제출과 포크 동기화

**제출** 탭은 아직 공식 `main`에 병합되지 않은 활성 주차 하나만 보여 줍니다. 문제 카드에서 직접 **커밋에 추가**한 풀이가 그래프의 아래쪽 `커밋 준비`에 들어가며, 커밋과 push를 거쳐 열린 PR까지 아래에서 위로 이어집니다. 스테이징 뒤 파일을 다시 수정하면 커밋을 중단하고 최신 내용을 다시 추가하도록 안내합니다.

한 주차의 열린 PR이나 공식 미반영 파일이 남아 있으면 다른 주차의 스테이징·커밋·push는 잠깁니다. 여러 주차가 이미 포크에 섞여 있으면 자동으로 합치지 않습니다. 병합된 풀이에는 문제 카드에 `병합 완료`를 표시하고 제출 그래프에서는 즉시 제거합니다. 병합 없이 닫힌 PR은 이력에 남기지 않으며, 포크에 남은 같은 주차 파일로 새 PR 작성 화면을 다시 열 수 있습니다.

제출과 동기화는 `origin`의 fetch·push URL이 동일하고, GitHub lineage에서 `DaleStudy/leetcode-study`의 포크로 확인된 저장소에서만 활성화됩니다. 커밋 직전에는 실제 스테이징 파일이 선택한 주차의 풀이와 정확히 일치하는지 다시 확인하고, push 직전에는 `origin/main..HEAD`의 모든 커밋이 같은 주차의 풀이만 포함하는지 검사합니다.

포크 동기화는 `main` 브랜치, 스테이징·추적 파일 수정·미푸시 커밋 없음, merge·rebase 미진행 상태에서만 실행합니다. 현재 브랜치의 upstream 설정에 의존하지 않고 `HEAD`, `origin/main`, `upstream/main`을 직접 비교하며, `origin/main`과 `upstream/main` 병합 중 충돌하면 merge를 중단합니다. 아직 스테이징하지 않은 untracked 풀이 파일은 보존하고 rebase·force push·자동 stash는 사용하지 않습니다.

## 알아둘 점

- 워크스페이스 루트에 유효한 `problem-categories.json`과 JSON 키에 대응하는 문제 폴더가 하나 이상 있어야 합니다.
- 제출 파일은 문제 폴더 바로 아래에서만 찾으며 `README.md`와 하위 폴더의 파일은 제외합니다.
- 새 풀이를 만들 때 같은 이름 또는 대소문자만 다른 파일이 있으면 덮어쓰지 않고 중단합니다.
- 제한 모드에서는 목록 조회만 지원합니다. 파일 생성·삭제·수정과 로컬 테스트에는 워크스페이스 신뢰가 필요합니다.
- Git 상태는 현재 브랜치의 upstream을 기준으로 계산합니다. Git 저장소가 아니거나 upstream이 없으면 `푸시 상태 확인 불가`로 표시합니다.
- GitHub 또는 Git 조회에 실패한 제출 파일은 `상태 확인 불가`로 표시하며, 공식 저장소보다 포크가 뒤처진 경우에는 동기화 전까지 `동기화 후 확인`으로 보수적으로 표시합니다.
- 문제 본문은 처음 요청할 때 LeetCode의 비공식 GraphQL API에서 불러와 확장을 다시 시작하기 전까지 캐시합니다. 네트워크 또는 API 오류가 발생하면 다시 시도하거나 LeetCode 페이지를 직접 열 수 있으며 Premium 문제의 비공개 본문은 표시하지 않습니다.
- **다른 사람 풀이**는 현재 체크아웃에 있는 본인 이외의 제출 파일을 대상으로 하며, 처음 열 때만 풀이 노출 가능성을 확인합니다.
- **정답 페이지**는 문제 폴더의 `README.md`에서 안전한 Algodale 문제 링크를 찾은 경우에만 활성화됩니다. 책 아이콘을 누를 때마다 확인한 뒤 외부 브라우저로 이동합니다.
- 문제 카드의 사람·삭제·책·외부 링크 아이콘은 마우스를 올리거나 키보드로 포커스하면 기능을 안내합니다.
- **파일 맨 끝에 빈줄 추가하기**는 Markdown 제출을 제외하고, 비어 있지 않은 내 제출 파일이 정확히 하나의 `\n`으로 끝나도록 정리합니다.

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
yarn lint
yarn typecheck
yarn test:unit
yarn test:integration
yarn test
```

테스트 데이터 동기화에는 `yarn dataset:sync`를 사용합니다. 통합 테스트는 `.tmp`에 격리된 멀티 루트 워크스페이스를 만든 뒤 `@vscode/test-electron`으로 실행합니다.

## VSIX 만들기

```sh
yarn package:vsix
```

모든 검사와 테스트가 성공하면 `.artifacts/leetcode-study-helper.vsix`가 생성됩니다. VS Code의 **Extensions: Install from VSIX...** 명령으로 설치할 수 있습니다.

## 라이선스

[MIT](LICENSE) 라이선스로 배포합니다. 이 프로젝트는 LeetCode 또는 DaleStudy의 공식 제품이 아닙니다.
