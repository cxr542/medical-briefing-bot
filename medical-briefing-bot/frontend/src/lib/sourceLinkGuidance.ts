const confirmedConstraints = new Set([
  '심평원 e-평가 (평가알림방)',
  '심평원 업무포탈 (자보알림방)',
  '산재업무포탈',
  '보건의료자원포탈',
]);

export function institutionGuidance(source: string): string {
  return confirmedConstraints.has(source)
    ? '기관 사이트 특성상 해당 공지로 직접 이동할 수 없습니다. 기관 페이지에서 아래 제목의 공지를 찾아주세요.'
    : '직접 상세 링크가 확인되지 않았습니다. 기관 페이지에서 아래 제목의 공지를 찾아주세요.';
}

export async function copyArticleTitle(
  title: string,
  clipboard?: Pick<Clipboard, 'writeText'>,
): Promise<boolean> {
  try {
    if (!clipboard) return false;
    await clipboard.writeText(title);
    return true;
  } catch {
    return false;
  }
}
