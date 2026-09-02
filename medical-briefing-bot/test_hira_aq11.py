import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        await page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle')
        await asyncio.sleep(3)
        
        texts = await page.evaluate('''
            Array.from(document.querySelectorAll('*')).map(el => {
                if(el.children.length === 0 && el.textContent.trim().length > 0) {
                    return el.tagName + ": " + el.textContent.trim();
                }
                return null;
            }).filter(Boolean)
        ''')
        
        for t in texts:
            if '알림' in t or '평가' in t or '게시' in t:
                print(t)
        
        await browser.close()

asyncio.run(main())
