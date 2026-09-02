import re

with open('frontend/src/components/ArticleList.tsx', 'r') as f:
    content = f.read()

helper = """
const formatLocalYYYYMMDD = (dateStr: string | Date | number) => {
  const d = new Date(dateStr);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export default function ArticleList"""

content = content.replace('export default function ArticleList', helper)

content = content.replace("new Date(a.published_date).toISOString().split('T')[0]", "formatLocalYYYYMMDD(a.published_date)")
content = content.replace("new Date().toISOString().split('T')[0]", "formatLocalYYYYMMDD(new Date())")
content = content.replace("new Date(article.published_date).toISOString().split('T')[0]", "formatLocalYYYYMMDD(article.published_date)")

with open('frontend/src/components/ArticleList.tsx', 'w') as f:
    f.write(content)
