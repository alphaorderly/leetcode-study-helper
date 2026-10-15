/** 제출 대상인 공식 스터디 저장소의 소유자입니다. 웹뷰와 호스트가 같은 값을 쓰도록 shared에 둡니다. */
export const CANONICAL_OWNER = 'DaleStudy';
/** 제출 대상인 공식 스터디 저장소 이름입니다. */
export const CANONICAL_REPOSITORY = 'leetcode-study';
/** `소유자/저장소` 형식의 공식 저장소 이름입니다. */
export const CANONICAL_FULL_NAME = `${CANONICAL_OWNER}/${CANONICAL_REPOSITORY}`;
/** 포크를 만드는 GitHub 페이지 주소입니다. 온보딩이 외부로 여는 유일한 고정 URL입니다. */
export const CANONICAL_FORK_URL = `https://github.com/${CANONICAL_FULL_NAME}/fork`;
