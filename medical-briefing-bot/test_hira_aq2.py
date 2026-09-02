import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        async def log_response(response):
            if 'hira.or.kr' in response.url and ('ndo' in response.url or 'jsp' in response.url):
                try:
                    text = await response.text()
                    if 'SSV' in text or 'Dataset' in text or '평가알림방' in text or '평가' in text:
                        print(f"URL: {response.url}")
                        print(f"Data: {text[:500]}")
                except Exception as e:
                    pass
                    
        page.on("response", log_response)
        
        print("Navigating...")
        await page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle')
        await asyncio.sleep(8)
        await browser.close()

asyncio.run(main())
