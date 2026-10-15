// Article.source is the existing string identity used by filters and counts.
// Keep this card-only registry separate from query/group membership rules.
export type SourceCardType = 'institution' | 'medical_press';

export const SOURCE_CARD_TYPES = {
  '건보공단 업무포탈': 'institution',
  '건보공단 업무포탈 (요양기관)': 'institution',
  '국가법령정보센터': 'institution',
  '국민건강보험공단 공지사항': 'institution',
  '대한병원협회 공지사항': 'institution',
  '보건복지부 법령': 'institution',
  '보건복지부 보도자료': 'institution',
  '보건의료자원포탈': 'institution',
  '산재업무포탈': 'institution',
  '식품의약품안전처 보도자료': 'institution',
  '심사평가원 공지사항': 'institution',
  '심평원 e-평가 (평가알림방)': 'institution',
  '심평원 업무포탈 (공지사항)': 'institution',
  '심평원 업무포탈 (자보알림방)': 'institution',
  '질병관리청 보도자료': 'institution',
  '데일리메디': 'medical_press',
  '메디게이트뉴스': 'medical_press',
  '메디컬타임즈': 'medical_press',
  '보건신문': 'medical_press',
  '의학신문': 'medical_press',
  '의협신문': 'medical_press',
  '청년의사': 'medical_press',
} as const satisfies Record<string, SourceCardType>;

export function groupSourceCards(sources: readonly string[]) {
  const groups: { id: SourceCardType | 'other'; title: string; sources: string[] }[] = [
    { id: 'institution', title: '주요 기관', sources: [] },
    { id: 'medical_press', title: '의료전문지', sources: [] },
    { id: 'other', title: '기타 출처', sources: [] },
  ];
  // Match the dashboard's existing Set + default sort ordering. Include configured
  // sources even when the current response has no articles for them (zero count).
  const types: Readonly<Record<string, SourceCardType>> = SOURCE_CARD_TYPES;
  for (const source of Array.from(new Set([...Object.keys(SOURCE_CARD_TYPES), ...sources])).sort()) {
    const type = Object.hasOwn(types, source) ? types[source] : 'other';
    groups.find(group => group.id === type)!.sources.push(source);
  }
  return groups.filter(group => group.sources.length > 0);
}
