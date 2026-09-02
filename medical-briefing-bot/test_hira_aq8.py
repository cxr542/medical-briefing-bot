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
        
        print("Clicking...")
        try:
            # In Nexacro, text might be inside a div.
            await page.evaluate('''
                const divs = Array.from(document.querySelectorAll('div'));
                const alrim = divs.find(d => d.textContent.trim() === '알림방');
                if (alrim) {
                    alrim.click();
                    console.log("Clicked 알림방");
                }
            ''')
            await asyncio.sleep(2)
            
            await page.evaluate('''
                const divs = Array.from(document.querySelectorAll('div'));
                const evalAlrim = divs.find(d => d.textContent.trim() === '평가알림방');
                if (evalAlrim) {
                    evalAlrim.click();
                    console.log("Clicked 평가알림방");
                }
            ''')
            await asyncio.sleep(3)
        except Exception as e:
            print(e)
            
        await browser.close()

asyncio.run(main())
