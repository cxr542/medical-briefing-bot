from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        def handle_response(response):
            if 'hurb.or.kr' in response.url and ('select' in response.url.lower() or 'list' in response.url.lower() or '.ndo' in response.url.lower() or '.do' in response.url.lower() or 'board' in response.url.lower()):
                try:
                    text = response.text()
                    if len(text) > 50:
                        print(f"URL: {response.url}")
                        print(text[:300])
                        print("-" * 50)
                except:
                    pass

        page.on("response", handle_response)
        page.goto('https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok', wait_until='networkidle')
        page.wait_for_timeout(5000)
        browser.close()

run()
