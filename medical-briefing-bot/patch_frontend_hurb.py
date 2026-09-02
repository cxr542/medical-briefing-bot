with open('frontend/src/components/ArticleList.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    "'대한병원협회 공지사항', '심사평가원 공지사항', '심평원 업무포탈 (공지사항)', '심평원 업무포탈 (자보알림방)', '국민건강보험공단 공지사항'",
    "'대한병원협회 공지사항', '심사평가원 공지사항', '심평원 업무포탈 (공지사항)', '심평원 업무포탈 (자보알림방)', '국민건강보험공단 공지사항', '보건의료자원포탈'"
)

with open('frontend/src/components/ArticleList.tsx', 'w') as f:
    f.write(content)
