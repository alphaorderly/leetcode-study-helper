import { describe, expect, it } from 'vitest';
import { buildPullRequestBody, buildPullRequestCompareUrl } from '../../src/git/pullRequestBody';

describe('buildPullRequestBody', () => {
  it('matches the DaleStudy PR template with issue checkboxes', () => {
    const body = buildPullRequestBody(['two-sum', 'valid-anagram']);

    expect(body).toContain('## 답안 제출 문제');
    expect(body).toContain('- [x] #219');
    expect(body).toContain('- [x] #218');
    expect(body).not.toContain('- [x] two-sum');
    expect(body).toContain('## 작성자 체크 리스트');
    expect(body).toContain('**Projects**');
    expect(body).toContain('**Week**');
    expect(body).toContain('`In Review`');
    expect(body).toContain('코드 검토자 1분 이상으로부터 승인을 받으셨다면 PR을 병합해주세요.');
    expect(body).toContain('## 검토자 체크 리스트');
    expect(body).toContain('> [!IMPORTANT]');
    expect(body).toContain('바로 이전에 올라온 PR에 본인을 코드 리뷰어로 추가해주세요.');
    expect(body).toContain('본인이 검토해야하는 PR의 답안 코드에 피드백을 주세요.');
    expect(body).toContain('토요일 전까지 PR을 병합할 수 있도록 승인해주세요.');
  });

  it('falls back to the slug when an issue number is unknown', () => {
    const body = buildPullRequestBody(['custom-problem']);

    expect(body).toContain('- [x] custom-problem');
    expect(body).not.toContain('- [x] #');
  });
});

describe('buildPullRequestCompareUrl', () => {
  it('encodes the PR body so GitHub can decode #issue references once', () => {
    const title = '[CaseUser] WEEK 08 Solutions';
    const body = buildPullRequestBody(['reverse-bits', 'clone-graph']);
    const url = buildPullRequestCompareUrl('CaseUser', 'week-08', title, body);
    const parsed = new URL(url);
    const decodedBody = parsed.searchParams.get('body');
    const decodedTitle = parsed.searchParams.get('title');

    expect(url).toContain('/DaleStudy/leetcode-study/compare/main...CaseUser:week-08');
    expect(url).not.toContain('%2523');
    expect(url).toContain('%23');
    expect(decodedTitle).toBe(title);
    expect(decodedBody).toBe(body);
    expect(decodedBody).toContain('## 답안 제출 문제');
    expect(decodedBody).toContain('- [x] #234');
    expect(decodedBody).toContain('- [x] #259');
  });
});
