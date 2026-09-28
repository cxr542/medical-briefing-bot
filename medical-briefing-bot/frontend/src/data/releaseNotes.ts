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
