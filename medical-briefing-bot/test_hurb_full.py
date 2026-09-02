from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        def handle_response(response):
            if 'selectPopupList.ndo' in response.url:
                try:
                    print(response.text()[:2000])
                except: pass

        page.on("response", handle_response)
        page.goto('https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok', wait_until='networkidle')
        page.wait_for_timeout(5000)
        browser.close()

run()
