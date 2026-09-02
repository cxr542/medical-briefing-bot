import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        async def log_response(response):
            if 'selectPopupList.ndo' in response.url:
                text = await response.text()
                with open('hira_aq_popup.xml', 'w') as f:
                    f.write(text)
                print("Saved to hira_aq_popup.xml")
        page.on("response", log_response)
        
        await page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle')
        await asyncio.sleep(2)
        await browser.close()

asyncio.run(main())
