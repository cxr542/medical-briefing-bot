import re

with open('frontend/src/components/ArticleList.tsx', 'r') as f:
    content = f.read()

# Currently: const allSources = useMemo(() => Array.from(new Set(articles.map(a => a.source))).sort(), [articles]);
# We will define a constant with all known sources.
KNOWN_SOURCES = """const KNOWN_SOURCES = [
  '메디게이트뉴스', '데일리메디', '메디컬타임즈', '청년의사', '의협신문', '의학신문', '보건신문',
  '보건복지부 법령', '건보공단 업무포탈', '건보공단 업무포탈 (요양기관)', '심평원 e-평가 (평가알림방)',
  '국가법령정보센터', '대한병원협회 공지사항', '심사평가원 공지사항', '심평원 업무포탈 (공지사항)', '심평원 업무포탈 (자보알림방)', '국민건강보험공단 공지사항'
];"""

replacement = """const allSources = useMemo(() => {
    const dbSources = Array.from(new Set(articles.map(a => a.source)));
    const combined = Array.from(new Set([...KNOWN_SOURCES, ...dbSources]));
    return combined.sort();
  }, [articles]);"""

content = content.replace("const PRESS_SOURCES", KNOWN_SOURCES + "\n\nconst PRESS_SOURCES")
content = content.replace("const allSources = useMemo(() => Array.from(new Set(articles.map(a => a.source))).sort(), [articles]);", replacement)

with open('frontend/src/components/ArticleList.tsx', 'w') as f:
    f.write(content)
