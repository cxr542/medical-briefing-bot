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
                    if 'SSV' in text and 'Dataset' in text:
                        if 'NtcSeq' in text or 'Title' in text or 'ntcTitle' in text or 'bltnTtl' in text or 'title' in text.lower():
                            print(f"URL: {response.url}")
                            print("FOUND BOARD DATA!")
                            print(text[:1000])
                except Exception as e:
                    pass
                    
        page.on("response", log_response)
        
        print("Navigating...")
        await page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle')
        await asyncio.sleep(2)
        
        print("Executing nexacro menu open...")
        try:
            await page.evaluate('''
                nexacro.getApplication().mainframe.VFrameSet0.HFrameSet0.VFrameSet1.TopFrame.form.fn_openMenu("AQ010601");
            ''')
            await asyncio.sleep(3)
        except Exception as e:
            print("Error:", e)
            
        await browser.close()

asyncio.run(main())
