import requests

api_key = "yhkimBriefing2026"
url = f"https://www.law.go.kr/DRF/lawSearch.do?OC={api_key}&target=law&type=XML&query=%EC%9D%98%EB%A3%8C%EB%B2%95"

response = requests.get(url)
print("Response Text (first 500 chars):", response.text[:500])
