/** DaleStudy 온보딩 주차 번호입니다. 1주차 앞에 오며 브랜치는 week-00을 씁니다. */
export const ONBOARDING_WEEK = 0;

/** 주차 번호를 두 자리 문자열로 바꿉니다. */
function pad(week: number): string {
  return String(week).padStart(2, '0');
}

/** 문제 목록·검색에 쓰는 한국어 주차 이름을 반환합니다. */
export function weekLabel(week: number): string {
  return week === ONBOARDING_WEEK ? '온보딩' : `${week}주차`;
}

/** 제출 화면·안내 문구에 쓰는 영문 주차 표기를 반환합니다. */
export function weekTag(week: number): string {
  return week === ONBOARDING_WEEK ? 'Onboarding' : `Week ${pad(week)}`;
}

/** 주차 제출의 PR 제목이자 기본 커밋 메시지를 만듭니다. */
export function submissionTitle(nickname: string, week: number): string {
  return week === ONBOARDING_WEEK
    ? `[${nickname}] Onboarding`
    : `[${nickname}] WEEK ${pad(week)} Solutions`;
}
