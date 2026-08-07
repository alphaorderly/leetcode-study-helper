import { getProblemIssue } from '../core/studySchedule';

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
