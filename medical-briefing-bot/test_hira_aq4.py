import asyncio
from playwright.async_api import async_playwright
import urllib.parse

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        async def log_response(response):
            if 'hira.or.kr' in response.url and 'ndo' in response.url:
                try:
                    text = await response.text()
                    if 'SSV' in text and 'Dataset' in text:
                        print(f"URL: {response.url}")
                        # print(f"Req: {response.request.post_data}")
                        # print(f"Data: {text[:500]}")
                        # Check if it has title columns
                        if 'NtcSeq' in text or 'Title' in text or 'ntcTitle' in text or 'Subject' in text or 'bltnTtl' in text:
                            print("FOUND BOARD DATA!")
                            print(text[:1000])
                except Exception as e:
                    pass
                    
        page.on("response", log_response)
        
        print("Navigating...")
        await page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle')
        await asyncio.sleep(2)
        
        # Click on 알림방 menu
        try:
            print("Clicking 알림방...")
            await page.get_by_text("알림방", exact=True).nth(0).click(force=True)
            await asyncio.sleep(2)
            
            print("Clicking 평가알림방...")
            await page.get_by_text("평가알림방", exact=True).nth(0).click(force=True)
            await asyncio.sleep(3)
        except Exception as e:
            print("Click error:", e)
        
        await browser.close()

asyncio.run(main())
