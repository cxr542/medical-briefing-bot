import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("Navigating...")
        await page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle')
        await asyncio.sleep(5)
        
        content = await page.content()
        print("Length:", len(content))
        
        # Check if it's Nexacro or just a normal site
        if 'nexacro' in content.lower():
            print("Detected Nexacro!")
        else:
            print("Not Nexacro. Dumping links...")
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(content, 'html.parser')
            for a in soup.select('a'):
                if '평가' in a.text or '알림' in a.text or '공지' in a.text:
                    print(a.text.strip(), a.get('href'))
        
        await browser.close()

asyncio.run(main())
