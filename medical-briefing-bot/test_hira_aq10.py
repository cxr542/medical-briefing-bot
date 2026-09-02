import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        await page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle')
        await asyncio.sleep(2)
        
        print("Finding fn_openMenu...")
        try:
            path = await page.evaluate('''
                function findFunction(obj, funcName, currentPath, visited) {
                    if (!obj || typeof obj !== 'object') return null;
                    if (visited.has(obj)) return null;
                    visited.add(obj);
                    
                    for (let key in obj) {
                        try {
                            let val = obj[key];
                            if (typeof val === 'function' && key === funcName) {
                                return currentPath + "." + key;
                            }
                            if (val && typeof val === 'object' && currentPath.split(".").length < 6) {
                                let res = findFunction(val, funcName, currentPath + "." + key, visited);
                                if (res) return res;
                            }
                        } catch(e) {}
                    }
                    return null;
                }
                findFunction(nexacro.getApplication().mainframe, 'fn_openMenu', 'nexacro.getApplication().mainframe', new Set());
            ''')
            print("Found path:", path)
            
            if path:
                print("Executing...")
                await page.evaluate(f'{path}("AQ010601")')
                await asyncio.sleep(3)
        except Exception as e:
            print("Error:", e)
            
        await browser.close()

asyncio.run(main())
