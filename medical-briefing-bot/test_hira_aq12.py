import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        async def log_response(response):
            if 'hira.or.kr' in response.url and 'ndo' in response.url:
                try:
                    text = await response.text()
                    if '폐렴' in text or '환자경험평가' in text or 'SSV' in text:
                        print(f"URL: {response.url}")
                        print(f"Size: {len(text)}")
                        print(f"Body: {response.request.post_data}")
                        if '폐렴' in text:
                            print(f"Snippet: {text[:500]}")
                            print("---------------------------------")
                except Exception as e:
                    pass
                    
        page.on("response", log_response)
        
        await page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle')
        await asyncio.sleep(4)
        await browser.close()

asyncio.run(main())
