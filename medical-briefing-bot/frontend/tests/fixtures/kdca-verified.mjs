export const kdcaNotices = [
  { title: '[10.8.목.조간] 임신당뇨병 산모의 자녀, 당뇨병 위험 최대 4배 이상 높아', id: '312868' },
  { title: '「아이치-나고야 하계 아시아경기대회」 감염병 예방은 마지막까지 빈틈없이!(10.6.화)', id: '312844' },
  { title: '질병관리청, 건전한 조직문화 조성을 위한 ‘청렴라이브(LIVE)’ 개최(10.2.금)', id: '312845' },
];

export function storedKdcaArticle(notice) {
  return {
    source: '질병관리청 보도자료', title: notice.title,
    url: `https://www.kdca.go.kr/bbs/kdca/42/artclList.do?page=1&srchColumn=title&srchWrd=${encodeURIComponent(notice.title)}`,
  };
}
