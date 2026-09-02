import re
with open('/Users/yhkim/.gemini/antigravity/brain/71778d7b-3b87-45fe-8617-0c46d48144a9/.system_generated/tasks/task-1659.log', 'r') as f:
    text = f.read()

# The format is SSV or XML? It was XML with <Row>...</Row>
for row in text.split('<Row>'):
    if '평가알림방' in row:
        print(row)
