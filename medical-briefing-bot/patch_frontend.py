import re

with open('frontend/src/components/ArticleList.tsx', 'r') as f:
    content = f.read()

# Add to PRESS_SOURCES
content = content.replace(
    "const PRESS_SOURCES: readonly string[] = ['메디게이트뉴스', '데일리메디', '메디컬타임즈', '청년의사', '의협신문'];",
    "const PRESS_SOURCES: readonly string[] = ['메디게이트뉴스', '데일리메디', '메디컬타임즈', '청년의사', '의협신문', '의학신문', '보건신문'];"
)

# Add colors
color_additions = """    else if (source.includes('데일리메디')) theme = { border: 'border-blue-300', text: 'text-blue-600', bullet: 'text-blue-500', buttonBorder: 'border-blue-200', buttonHover: 'hover:bg-blue-50 hover:text-blue-600', groupHoverText: 'group-hover:text-blue-600' };
    else if (source.includes('의학신문')) theme = { border: 'border-rose-300', text: 'text-rose-600', bullet: 'text-rose-500', buttonBorder: 'border-rose-200', buttonHover: 'hover:bg-rose-50 hover:text-rose-600', groupHoverText: 'group-hover:text-rose-600' };
    else if (source.includes('보건신문')) theme = { border: 'border-cyan-300', text: 'text-cyan-600', bullet: 'text-cyan-500', buttonBorder: 'border-cyan-200', buttonHover: 'hover:bg-cyan-50 hover:text-cyan-600', groupHoverText: 'group-hover:text-cyan-600' };
    else if (source.includes('건보공단')) theme = { border: 'border-yellow-400', text: 'text-yellow-700', bullet: 'text-yellow-600', buttonBorder: 'border-yellow-200', buttonHover: 'hover:bg-yellow-50 hover:text-yellow-700', groupHoverText: 'group-hover:text-yellow-700' };"""

content = content.replace(
    "    else if (source.includes('데일리메디')) theme = { border: 'border-blue-300', text: 'text-blue-600', bullet: 'text-blue-500', buttonBorder: 'border-blue-200', buttonHover: 'hover:bg-blue-50 hover:text-blue-600', groupHoverText: 'group-hover:text-blue-600' };",
    color_additions
)

with open('frontend/src/components/ArticleList.tsx', 'w') as f:
    f.write(content)

