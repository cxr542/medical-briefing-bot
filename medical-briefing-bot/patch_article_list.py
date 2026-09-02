import re

with open('frontend/src/components/ArticleList.tsx', 'r') as f:
    content = f.read()

# 1. Add state
content = content.replace(
    "const [showStatusTooltip, setShowStatusTooltip] = useState(false);",
    "const [showStatusTooltip, setShowStatusTooltip] = useState(false);\n  const [showAllNotices, setShowAllNotices] = useState(false);"
)

# 2. Modify currentNotices assignment
content = content.replace(
    "const currentNotices = topNotices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);",
    "const currentNotices = showAllNotices ? topNotices : topNotices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);"
)

# 3. Modify button
old_button = """                  <button className="text-sm font-medium text-gray-600 border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 transition-colors">
                    전체 보기 →
                  </button>"""
new_button = """                  <button onClick={() => setShowAllNotices(!showAllNotices)} className="text-sm font-medium text-gray-600 border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 transition-colors">
                    {showAllNotices ? '페이징 보기 ↑' : '전체 보기 →'}
                  </button>"""
content = content.replace(old_button, new_button)

# 4. Hide pagination if showAllNotices is true
content = content.replace(
    "{totalPages > 1 && (",
    "{!showAllNotices && totalPages > 1 && ("
)

with open('frontend/src/components/ArticleList.tsx', 'w') as f:
    f.write(content)
