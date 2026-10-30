# 첫 온보딩 PR 제출 영상 제작 가이드 (Codex용)

처음 쓰는 사용자가 이 확장으로 **온보딩(0주차) 문제 `to-lower-case`를 풀고 `[닉네임] Onboarding` PR 작성 화면까지 가는 과정**을 영상으로 만듭니다. 이 문서는 그 작업을 맡은 Codex가 읽고 그대로 따르는 절차서입니다.

## Codex에게 줄 프롬프트

```text
docs/onboarding-video/CODEX_GUIDE.md를 처음부터 끝까지 읽고 그 절차대로 온보딩 리허설 영상을 만들어 줘.
filmcraft 스킬은 편집·자막·내보내기에 쓰고, 녹화는 가이드의 방식대로 해.
실제 GitHub와 DaleStudy 저장소에는 아무것도 push하거나 PR을 만들지 마.
단계마다 가이드의 확인 항목을 통과한 뒤 다음 단계로 넘어가고, 막히면 추측하지 말고 멈춰서 보고해.
```

## 0. 전제와 금지 사항

**전제**
- 이 영상은 **리허설**입니다. 2026-10-30 현재 DaleStudy/leetcode-study에는 `to-lower-case`가 아직 없습니다. 그래서 공식 저장소와 GitHub를 로컬 목업으로 흉내 냅니다. 공식 저장소에 문제가 추가되면 마지막 GitHub 장면만 실제 화면으로 다시 찍습니다 (9장).
- 화면에 나오는 사용자는 **전용 데모 계정**입니다. 이 문서에서는 `onboarding-demo`라는 자리표시자로 부릅니다. 실제 계정 이름은 사용자에게 받으세요. 이 리허설에서는 그 이름을 텍스트로만 쓰고, GitHub에 로그인하지 않습니다.
- 영상은 **PR 작성 화면에서 끝납니다.** "Create pull request"를 누르지 않습니다.

**금지 사항**
- 실제 `github.com`이나 `api.github.com`으로 push, PR 생성, 포크 생성, 쓰기 요청을 보내지 않습니다. 허용되는 실제 네트워크 접근은 1-1의 공개 저장소 읽기 전용 clone 한 번뿐입니다.
- VS Code에서 GitHub 로그인을 하지 않습니다. 토큰이 목업 서버로 가는 일을 막기 위해서입니다. 확장은 토큰 없이도 공개 API 경로를 호출합니다.
- 데모용 코드 변경은 이 저장소의 `main`에 커밋하거나 병합하지 않습니다. 반드시 별도 worktree와 브랜치(2장)에서만 합니다.
- 사용자의 전역 git 설정(`~/.gitconfig`)과 실제 VS Code 프로필을 바꾸지 않습니다. 모든 설정은 데모 디렉터리 안의 저장소 로컬 설정과 별도 `--user-data-dir`에 둡니다.
- 화면에 실제 개인 정보(사용자 홈 경로의 실명, 다른 저장소, 알림)가 보이지 않게 합니다.

## 1. 작업 디렉터리와 목업 저장소

모든 산출물은 저장소 밖의 `~/onboarding-video/`(이하 `$DEMO`)에 둡니다.

```text
$DEMO/
  mock-upstream.git          공식 저장소 목업 (bare)
  mock-origin.git            데모 계정 포크 목업 (bare)
  workspace/leetcode-study   VS Code에서 열 데모 클론
  vscode-profile/            --user-data-dir
  vscode-extensions/         --extensions-dir (비워 둠)
  mock-github/               목업 GitHub 서버
  raw/                       녹화 원본
  edit/                      FilmCraft 프로젝트·자막·내레이션
  out/                       최종 영상
```

### 1-1. 공식 저장소 목업 만들기
1. 실제 화면처럼 보이도록 공개 저장소를 읽기 전용으로 한 번 clone합니다.
   ```sh
   git clone --depth 1 https://github.com/DaleStudy/leetcode-study.git "$DEMO/seed"
   ```
2. `seed`에 업스트림이 할 것으로 예상되는 변경을 커밋 하나로 추가합니다.
   - `to-lower-case/README.md`: 다른 문제 디렉터리의 README 형식을 그대로 따릅니다. LeetCode 링크는 `https://leetcode.com/problems/to-lower-case/`입니다.
   - `problem-categories.json`: `"to-lower-case"` 항목을 추가합니다. 다른 항목과 같은 필드를 쓰고, 난이도는 `Easy`입니다.
   - 커밋 메시지 예: `chore: add onboarding problem to-lower-case (rehearsal mock)`
3. 이 상태를 `mock-upstream.git`(bare)으로 push합니다. `seed`의 origin은 지우거나 `mock-upstream.git`로 바꿔, 실제 DaleStudy로 push될 경로를 없앱니다.
4. 같은 내용을 `mock-origin.git`(bare)에도 push합니다. 포크의 `main`이 공식 `main`과 같은 상태가 됩니다.

### 1-2. 데모 클론과 URL 가로채기
1. `mock-origin.git`을 `workspace/leetcode-study`로 clone합니다.
2. 원격 URL은 **실제 GitHub 주소 문자열**로 둡니다. 확장은 이 문자열로 포크와 공식 저장소를 판별합니다.
   ```sh
   git -C "$DEMO/workspace/leetcode-study" remote set-url origin https://github.com/onboarding-demo/leetcode-study.git
   ```
3. 실제 전송은 **저장소 로컬 설정의 `insteadOf`**로 목업에 보냅니다. `--global`을 쓰지 않습니다.
   ```sh
   cd "$DEMO/workspace/leetcode-study"
   git config --local url."$DEMO/mock-origin.git".insteadOf https://github.com/onboarding-demo/leetcode-study.git
   git config --local url."$DEMO/mock-upstream.git".insteadOf https://github.com/DaleStudy/leetcode-study.git
   git config --local user.name onboarding-demo
   git config --local user.email onboarding-demo@example.invalid
   ```
4. **확인:** 아래 두 명령이 모두 목업의 커밋을 보여 주고 네트워크 오류가 없어야 합니다.
   ```sh
   git ls-remote https://github.com/onboarding-demo/leetcode-study.git main
   git ls-remote https://github.com/DaleStudy/leetcode-study.git main
   ```
   두 결과가 `mock-upstream.git`의 `main`과 같은 SHA인지 확인합니다. 실제 DaleStudy의 SHA가 나오면 즉시 중단합니다.

확장은 공식 원격이 없으면 스스로 추가합니다(`src/infrastructure/git/submission/submissionBranches.ts`의 `ensureCanonicalRemote`). 추가되는 URL도 위의 `insteadOf`에 걸리므로 별도 처리가 필요 없습니다.

## 2. 데모 전용 확장 빌드

GitHub API 주소(`src/infrastructure/github/githubHttpClient.ts`의 `https://api.github.com`)와 PR 작성 화면 주소(`src/infrastructure/github/pullRequestBody.ts`의 `https://github.com`)는 코드에 고정되어 있습니다. 목업으로 돌리려면 데모 브랜치에서만 쓰는 작은 패치가 필요합니다.

1. 이 저장소에서 데모 전용 worktree를 만듭니다. 원래 checkout은 건드리지 않습니다.
   ```sh
   git worktree add ../leetcode-study-helper-demo -b demo/onboarding-video
   ```
2. worktree 안에서만 다음을 바꿉니다.
   - API 기본 주소: 환경 변수 `LSH_DEMO_GITHUB_API_BASE`가 있으면 그 값을 쓰고, 없으면 `https://api.github.com`을 씁니다.
   - PR 비교 화면 기본 주소: `LSH_DEMO_GITHUB_WEB_BASE`가 있으면 그 값을 쓰고, 없으면 `https://github.com`을 씁니다.
   - `grep -rn "https://github.com\|api.github.com" src`로 영상 경로에 나오는 다른 고정 주소가 있는지 확인합니다. 영상에 나오지 않는 링크(포크 만들기 안내 등)는 그대로 둡니다.
3. `yarn compile`로 빌드하고 `yarn test:unit`이 통과하는지 확인합니다.
4. 이 브랜치는 영상 작업이 끝나면 지웁니다. `main`에 병합하지 않습니다.

## 3. 목업 GitHub 서버

`$DEMO/mock-github/`에 의존성 없는 Node.js(`node:http`) 서버를 만들고 `127.0.0.1`의 고정 포트(예: 8787)에서 띄웁니다.

**응답은 추측하지 말고 코드의 타입을 따릅니다.** 요청 경로와 응답 형태는 `src/infrastructure/github/githubSubmissionClient.ts`에 정의되어 있습니다. 이 파일의 `GitHubRepositoryResponse`, `GitHubCompareResponse`, `GitHubPullRequest`, `GitHubPullFile`, `GitHubTreeResponse` 타입과 그 타입을 쓰는 요청 경로를 읽고 그대로 구현합니다. 필요한 요청은 다음과 같습니다.

| 요청 | 응답 |
| --- | --- |
| `GET /repos/onboarding-demo/leetcode-study` | `fork: true`, `full_name`, 그리고 `source`·`parent`의 `full_name`이 `DaleStudy/leetcode-study` |
| `GET /repos/DaleStudy/leetcode-study/pulls?...` | `[]` (열린 PR 없음) |
| `GET /repos/DaleStudy/leetcode-study/compare/main...onboarding-demo:<branch>` | 두 bare 저장소에 실제 `git`을 실행해 `ahead_by`, `behind_by`, `total_commits`, `files`, `commits`를 계산합니다. 브랜치가 없으면 404 |
| `GET /repos/DaleStudy/leetcode-study/git/trees/main?recursive=1` | `mock-upstream.git`의 `git ls-tree -r`로 만든 트리 |
| `GET /repos/DaleStudy/leetcode-study/pulls/<n>/files` | PR이 없으므로 이 리허설에서는 호출되지 않아야 합니다. 호출되면 로그에 남기고 404를 반환합니다 |

- 알 수 없는 경로는 404를 반환하고 경로를 로그에 남깁니다. 리허설 중 로그를 보고 빠진 경로를 채웁니다.
- 요청에 `Authorization` 헤더가 오면 로그에 경고를 남깁니다. 로그인하지 않았다면 이 헤더는 오지 않아야 합니다.

**PR 작성 화면 목업:** `GET /DaleStudy/leetcode-study/compare/main...onboarding-demo:week-00?expand=1&title=...&body=...`에 대해, 쿼리의 `title`과 `body`를 보여 주는 단순한 페이지를 반환합니다.
- GitHub 로고, 상표, 화면 디자인을 흉내 내지 않습니다. 중립적인 스타일을 쓰고, 상단에 "PR 작성 화면 (리허설 목업)"이라고 표시합니다.
- 제목 입력란에는 `title`을, 본문 영역에는 `body`를 Markdown 원문 그대로 보여 줍니다.
- "Create pull request" 버튼은 넣지 않습니다.

## 4. 처음 사용하는 사용자 환경으로 VS Code 띄우기

```sh
LSH_DEMO_GITHUB_API_BASE=http://127.0.0.1:8787 \
LSH_DEMO_GITHUB_WEB_BASE=http://127.0.0.1:8787 \
code --new-window \
  --user-data-dir "$DEMO/vscode-profile" \
  --extensions-dir "$DEMO/vscode-extensions" \
  --extensionDevelopmentPath "<demo worktree 절대 경로>" \
  "$DEMO/workspace/leetcode-study"
```

- 새 `--user-data-dir`를 쓰므로 닉네임이 비어 있고 온보딩 체크리스트가 처음부터 보입니다. 처음 사용하는 사용자와 같은 상태입니다.
- 녹화 전에 `$DEMO/vscode-profile/User/settings.json`에 화면 설정을 넣습니다.
  - 기본 밝은 테마
  - `"window.zoomLevel": 1` 정도의 큰 글자
  - 미니맵, 알림 배지, 텔레메트리 안내 끄기
  - `"workbench.startupEditor": "none"`
- 창 크기는 1920×1080 녹화 영역에 맞춥니다. 사이드바에서 "리트코드 스터디 도우미" 뷰를 엽니다.
- **확인:** 온보딩 체크리스트의 첫 풀이 제안이 `to-lower-case`이고, 문제 목록 맨 앞에 "온보딩" 그룹이 있어야 합니다. 제출 탭에서 포크가 확인됨(verified)으로 표시되어야 합니다. 아니면 3장의 서버 로그부터 확인합니다.

## 5. 촬영 대본

장면별로 끊어서 녹화합니다. 한 장면이 실패하면 그 장면만 다시 찍습니다. 각 장면 전에 저장소 상태를 되돌리는 방법을 정해 둡니다(6-3).

| # | 장면 | 화면에서 할 일 | 확인 |
| --- | --- | --- | --- |
| 1 | 시작 | 확장 뷰를 열고 온보딩 체크리스트를 보여 줍니다 | 저장소 단계가 완료로 표시됨 |
| 2 | 닉네임·언어 | 닉네임 `onboarding-demo`와 언어 Python 3를 설정합니다 | 체크리스트 2단계 완료 |
| 3 | 온보딩 문제 열기 | "온보딩" 그룹의 `to-lower-case`에서 새 풀이를 만듭니다 | `to-lower-case/onboarding-demo.py`가 열림 |
| 4 | 풀이 작성 | 짧은 풀이를 타이핑합니다(아래 예시) | 저장됨 |
| 5 | 커밋에 추가 | 문제 카드에서 커밋에 추가(스테이징)합니다 | 제출 탭에 Onboarding 표시, 브랜치 `week-00` 준비 |
| 6 | 커밋 | 제출 탭에서 기본 메시지 `[onboarding-demo] Onboarding`을 보여 주고 커밋합니다 | 현재 브랜치 `week-00` |
| 7 | push | origin에 push합니다 | `mock-origin.git`에 `week-00` 생김 (`git -C $DEMO/mock-origin.git branch`) |
| 8 | PR 작성 화면 | PR 작성 화면을 엽니다 | 목업 페이지 제목 `[onboarding-demo] Onboarding`, 본문에 `- [x] #2885` |

장면 4의 풀이 예시:

```python
class Solution:
    def toLowerCase(self, s: str) -> str:
        return s.lower()
```

- `to-lower-case`의 Python 테스트 데이터를 지원합니다. 이 대본은 제출 과정에 초점을 맞춰 테스트 실행 장면은 넣지 않습니다.
- 포크 만들기와 클론은 실제 GitHub 화면이 필요하므로 촬영하지 않습니다. 편집 단계에서 "포크하고 클론한 뒤 시작합니다"라는 안내 카드로 대신합니다.

## 6. 녹화

### 6-1. 조작 방식
- 화면 조작은 Codex Computer Use로 합니다. 녹화 중에는 VS Code 창이 화면 맨 앞에 보여야 하므로 **전체 화면 제어**가 필요합니다. 시작 전에 사용자에게 녹화 시간 동안 컴퓨터를 만지지 말라고 알리고 승인을 받습니다.
- 클릭은 사람처럼 천천히 합니다. 동작 사이에 1–2초 쉬고, 타이핑은 한 번에 붙여 넣지 말고 입력합니다. 시청자가 따라올 시간을 주기 위해서입니다.
- 클릭 전에 스크린숏으로 위치를 확인합니다. 화면을 보지 않고 좌표만으로 클릭하지 않습니다.

### 6-2. 녹화 명령
macOS 기본 `screencapture`로 VS Code 창 영역만 녹화합니다. 터미널에 화면 기록 권한이 없으면 사용자에게 시스템 설정에서 허용해 달라고 요청하고 멈춥니다.

```sh
screencapture -v -C -k -V 90 -R<x>,<y>,1920,1080 "$DEMO/raw/scene-05.mov"
```

- `-C`는 커서를, `-k`는 클릭 표시를 포함하고, `-V`는 최대 길이(초), `-R`은 녹화 영역입니다.
- 장면마다 파일을 하나씩 만들고 이름에 장면 번호를 붙입니다.
- **확인:** 장면마다 `ffprobe`로 길이, 해상도, 프레임 수를 확인합니다. 장면 중간 지점의 프레임 하나를 PNG로 뽑아 내용이 맞는지 눈으로 봅니다.

### 6-3. 장면 다시 찍기
- 6장 이후 장면을 다시 찍을 때는 `git switch main`, `git branch -D week-00`, `mock-origin.git`에서 `week-00` 삭제, 풀이 파일 삭제로 원래 상태로 돌립니다.
- 처음부터 다시 하려면 1-1의 bare 저장소와 `vscode-profile`을 지우고 다시 만듭니다.

## 7. FilmCraft로 편집하기

편집, 자막, 내보내기는 **filmcraft 스킬**을 따릅니다. CLI는 `~/.local/share/filmcraft/0.13.0/filmcraft-cli`이고, 버전 0.13.0을 확인했습니다. GUI 없이 CLI로 작업합니다.

1. **명령 id는 지어내지 않습니다.** 쓰기 전에 `filmcraft-cli commands <키워드>`와 `filmcraft-cli describe <id>`로 확인합니다. filmcraft 스킬의 "Enumerate before you guess" 원칙입니다.
2. **처리 순서**
   - 새 프로젝트 `$DEMO/edit/onboarding.fcproj`를 만들고 `raw/*.mov`를 장면 순서대로 가져옵니다.
   - 1080p 30fps 시퀀스에 배치합니다.
   - 로딩이나 대기 같은 빈 구간을 잘라 각 장면을 5–20초로 줄입니다. 반복 작업은 `run script.jsonl`로 한 번에 실행합니다.
3. **안내 카드**
   - 맨 앞에 제목 카드("리트코드 스터디 도우미 · 첫 온보딩 PR 제출")를 넣습니다.
   - 장면 1 앞에 "포크하고 클론한 뒤 시작합니다" 카드를 넣습니다.
   - 맨 끝에 "실제 화면에서는 GitHub PR 작성 화면에서 Create pull request를 누르면 제출됩니다" 카드를 넣습니다.
4. **리허설 표시:** 화면 구석에 "리허설 · 실제 GitHub 화면 아님" 문구를 영상 전체에 넣습니다. 장면 8에서는 반드시 보여야 합니다.
5. **자막**
   - 장면별 한국어 자막을 SRT로 쓰고, FilmCraft의 자막 가져오기로 넣은 뒤 burn-in으로 내보냅니다.
   - 한글 글꼴이 깨지지 않는지 `filmcraft-cli render --seconds <t> --out frame.png`로 자막이 있는 프레임을 렌더링해 확인합니다.
6. **내레이션 (선택):** `tts-cli`의 로컬 MLX 백엔드(`--backend mlx`)로 장면별 한국어 WAV를 만듭니다. 로컬 생성이라 텍스트를 외부로 보내지 않습니다. 생성된 음성이 원문과 다를 수 있으니 들어 보고 확인합니다. 내레이션 길이에 맞춰 장면 길이를 조정합니다.
7. **내보내기**
   - H.264 MP4로 내보냅니다. 프리셋 이름은 `filmcraft-cli export --list-presets h264`에서 고릅니다.
   - 오프라인 미디어가 있으면 내보내기가 실패하도록 `--allow-offline`을 쓰지 않습니다.

## 8. 최종 확인

FilmCraft는 알파 버전입니다. 내보내기가 성공해도 결과물을 직접 확인합니다.

- 명령의 종료 코드가 0이고, 결과에 `offlineMedia`가 비어 있습니다.
- `ffprobe out/onboarding-rehearsal.mp4`로 확인합니다.
  - 1920×1080, H.264, 예상 길이(대략 1분 30초~3분)
  - 내레이션을 넣었다면 오디오 스트림이 있음
- 아래 지점마다 프레임을 뽑아 확인합니다.
  - 장면 6: 커밋 메시지 `[onboarding-demo] Onboarding`이 읽힘
  - 장면 8: PR 제목 `[onboarding-demo] Onboarding`과 `#2885`가 읽힘
  - 리허설 표시가 보임
  - 자막이 화면 밖으로 잘리지 않음
- 화면에 실제 사용자 이름, 이메일, 토큰, 개인 경로, 알림이 보이지 않습니다.

결과 보고에는 다음을 포함합니다.
- 최종 영상 경로와 FilmCraft 프로젝트 경로
- 장면별 길이
- 확인한 프레임 이미지
- 목업 서버 로그에 남은 미처리 경로 목록

## 9. 정리와 실제 화면으로 다시 찍기

- 목업 서버를 종료합니다.
- 데모 worktree를 지웁니다(`git worktree remove`, `git branch -D demo/onboarding-video`).
- `$DEMO`의 원본 녹화는 사용자가 지우라고 할 때까지 남겨 둡니다.

DaleStudy 공식 저장소에 `to-lower-case`가 추가되면 다음 순서로 실제 영상을 만듭니다.
1. `gh api repos/DaleStudy/leetcode-study/contents/to-lower-case`로 문제가 추가되었는지 먼저 확인합니다.
2. 전용 데모 계정의 실제 포크와 이 저장소의 정식 빌드(데모 패치 없음)로 같은 대본을 찍습니다.
3. 장면 8은 실제 GitHub PR 작성 화면에서 멈춥니다. Create pull request는 누르지 않습니다.
4. 리허설 표시를 빼고 같은 FilmCraft 프로젝트에서 장면 클립만 교체합니다.
