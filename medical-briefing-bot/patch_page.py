with open('frontend/src/app/page.tsx', 'r') as f:
    content = f.read()

# Remove the neurology link
content = content.replace(
"""          <Link href="/neurology-dashboard" className="flex items-center gap-2 bg-white/20 hover:bg-white/30 transition-colors px-4 py-1.5 rounded-full text-xs md:text-sm">
            <span>📊 신경과 지표 대시보드</span>
          </Link>""", ""
)

with open('frontend/src/app/page.tsx', 'w') as f:
    f.write(content)
