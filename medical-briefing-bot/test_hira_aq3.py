import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        async def log_response(response):
            if 'hira.or.kr' in response.url and 'selectMenu.ndo' in response.url:
                try:
                    text = await response.text()
                    lines = text.split('\n')
                    for i, line in enumerate(lines):
                        if '알림' in line or '평가' in line:
                            print(line)
                except Exception as e:
                    pass
                    
        page.on("response", log_response)
        
        await page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle')
        await asyncio.sleep(3)
        await browser.close()

asyncio.run(main())
