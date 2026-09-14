import { getProblemIssue } from '../../domain/study/studySchedule';
import { CANONICAL_FULL_NAME } from './githubSubmissionClient';

/**
 * 전달받은 slug 순서대로 스터디 이슈 체크리스트와 공통 안내를 만듭니다.
 * 이슈 매핑이 없으면 slug를 그대로 표시합니다. 중복 제거는 호출자가 담당합니다.
 */
export function buildPullRequestBody(slugs: readonly string[]): string {
  const problemLines = slugs.map((slug) => {
    const issue = getProblemIssue(slug);
    return issue === undefined ? `- [x] ${slug}` : `- [x] #${issue}`;
  });
  return [
    '## 답안 제출 문제',
    '',
    ...problemLines,
    '',
    '## 작성자 체크 리스트',
    '',
    '- [ ] **Projects**의 오른쪽 버튼(▼)을 눌러 확장한 뒤, **Week**를 현재 주차로 설정해주세요.',
    '- [ ] 문제를 모두 푸시면 프로젝트에서 **Status**를 `In Review`로 설정해주세요.',
    '- [ ] 코드 검토자 1분 이상으로부터 승인을 받으셨다면 PR을 병합해주세요.',
    '',
    '## 검토자 체크 리스트',
    '',
    '> [!IMPORTANT]',
    '> 본인 답안 제출 뿐만 아니라 다른 분 PR 하나 이상을 반드시 검토를 해주셔야 합니다!',
    '',
    '- [ ] 바로 이전에 올라온 PR에 본인을 코드 리뷰어로 추가해주세요.',
    '- [ ] 본인이 검토해야하는 PR의 답안 코드에 피드백을 주세요.',
    '- [ ] 토요일 전까지 PR을 병합할 수 있도록 승인해주세요.',
  ].join('\n');
}

/**
 * 공식 main을 base, 포크 주차 브랜치를 head로 하는 GitHub 비교 URL을 만듭니다.
 * 제목·본문은 쿼리 값으로 인코딩합니다. URL 생성 자체로 PR을 생성하거나 브라우저를 열지 않습니다.
 */
export function buildPullRequestCompareUrl(
  owner: string,
  branch: string,
  title: string,
  body: string,
): string {
  const compare = `https://github.com/${CANONICAL_FULL_NAME}/compare/main...${owner}:${branch}`;
  return `${compare}?expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
