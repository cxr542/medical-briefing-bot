import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        async def log_response(response):
            if 'medicare.nhis.or.kr' in response.url:
                try:
                    text = await response.text()
                    if '공지사항' in text or 'notice' in response.url.lower():
                        print(f"URL: {response.url}")
                        print(f"Data: {text[:500]}")
                except:
                    pass
                    
        page.on("response", log_response)
        
        print("Navigating...")
        await page.goto('https://medicare.nhis.or.kr/portal/index.do', wait_until='networkidle')
        await asyncio.sleep(5)
        
        # Let's dump the text of the page to see if "공지사항" is visible
        content = await page.content()
        if "공지사항" in content:
            print("공지사항 text found in DOM!")
            
        await browser.close()

asyncio.run(main())
