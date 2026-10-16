import generatedReleaseNotes from './generatedReleaseNotes.json';

export type ReleaseNote = {
  id: string;
  date: string;
  category: '기능' | '개선' | '버그 수정' | '운영';
  title: string;
  summary: string;
  issues: string[];
  changes: string[];
  verification: string[];
  links: { label: string; url: string }[];
};

const curatedReleaseNotes: ReleaseNote[] = [
  {
    id: '2026-09-28-collector-admin-stability',
    date: '2026.09.28',
    category: '운영',
    title: 'Collector & Admin 운영 안정화',
    summary: '수집 신뢰성을 강화하고 KDCA·HIRA 장애 복구, Admin 릴리즈노트, PR merge 자동 기록, 사용자 표시 스케줄 정규화까지 운영 체계를 통합 개선했습니다.',
    issues: [
      'HIRA 자보알림방 최신 게시물 누락 및 잘못된 응답 정상 처리 가능성',
      'KDCA RSS placeholder와 정부기관 네트워크 timeout으로 인한 수집 불안정',
      '운영 변경 이력의 Admin 추적 및 자동 누적 체계 부재',
      'Collector runtime 12:07이 사용자 화면 마지막 확인 시간으로 노출',
    ],
    changes: [
      'HIRA 대상 게시판 실제 응답 대기 및 fail-loud 검증 강화',
      'KDCA 공식 HTML fallback과 DB-boundary article validation 적용',
      '정부기관 요청 retry/backoff/timeout 강화 및 DELETED 기사 화면 제외',
      'Admin Monitoring에 릴리즈 노트 메뉴와 curated/generated 통합 표시 추가',
      'release-note 라벨 PR merge 후 generatedReleaseNotes.json 자동 생성 파이프라인 구축',
      '06:07→06:00, 12:07→12:00, 15:07→15:00 사용자 표시 스케줄 정규화',
    ],
    verification: [
      'Collector Run #58 SUCCESS, 17개 source 전체 OK',
      '171건 수집·AI 처리, DB 85/85 성공, 실패 0건',
      '자동 릴리즈노트 E2E #36 및 후속 #37 연속 성공',
      '관련 Vercel Preview 검증 후 merge',
    ],
    links: [
      { label: 'PR #32', url: 'https://github.com/cxr542/medical-briefing-bot/pull/32' },
      { label: 'PR #36', url: 'https://github.com/cxr542/medical-briefing-bot/pull/36' },
      { label: 'PR #37', url: 'https://github.com/cxr542/medical-briefing-bot/pull/37' },
      { label: 'Run #58', url: 'https://github.com/cxr542/medical-briefing-bot/actions/runs/36376183065' },
    ],
  },
  {
    id: '2026-09-28-collector-stability',
    date: '2026.09.28',
    category: '운영',
    title: 'Collector 안정화 및 KDCA · HIRA 복구',
    summary: 'KDCA RSS 오류와 심평원 자보알림방 누락을 복구하고 외부 기관 수집 실패가 조용히 통과하지 않도록 방어 계층을 강화했습니다.',
    issues: [
      'KDCA RSS placeholder가 정상 기사처럼 저장·노출되던 문제',
      '심평원 자보알림방 신규 공지가 수집되지 않던 문제',
      '정부기관 일시적 timeout으로 여러 source가 동시에 실패하던 문제',
    ],
    changes: [
      'KDCA RSS 실패 시 공식 보도자료 HTML 목록 fallback 추가',
      'HIRA 자보알림방의 실제 게시판 응답을 확인할 때까지 대기하도록 개선',
      '빈 URL·placeholder 등 잘못된 article을 DB 저장 직전에 차단',
      'DELETED article을 Frontend 조회 및 렌더링에서 제외',
      '정부기관 GET/NHIS 요청의 retry·backoff·timeout 강화',
    ],
    verification: [
      'Collector Run #58: SUCCESS',
      '17개 source 전체 OK',
      '171건 수집 / AI output 171건',
      'DB 85건 시도 / 85건 성공 / 실패 0건',
      'KDCA 최신 보도자료 5건 정상 수집, HIRA 자보알림방 정상 복구',
    ],
    links: [
      { label: 'Run #58', url: 'https://github.com/cxr542/medical-briefing-bot/actions/runs/36376183065' },
      { label: 'PR #24–#31', url: 'https://github.com/cxr542/medical-briefing-bot/pulls?q=is%3Apr+is%3Aclosed+24..31' },
    ],
  },
];


const allowedCategories = new Set<ReleaseNote['category']>(['기능', '개선', '버그 수정', '운영']);
const generated = (generatedReleaseNotes as ReleaseNote[]).filter(note => allowedCategories.has(note.category));
export const releaseNotes: ReleaseNote[] = [...generated, ...curatedReleaseNotes];
