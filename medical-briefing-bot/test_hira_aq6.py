import asyncio
from playwright.async_api import async_playwright
import xml.etree.ElementTree as ET

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        async def log_response(response):
            if 'selectMenu.ndo' in response.url:
                text = await response.text()
                try:
                    root = ET.fromstring(text)
                    for ds in root.findall('.//{http://www.nexacroplatform.com/platform/dataset}Dataset'):
                        if ds.attrib.get('id') == 'dsMenu':
                            for row in ds.findall('.//{http://www.nexacroplatform.com/platform/dataset}Row'):
                                text_content = "".join(row.itertext())
                                if '평가알림방' in text_content:
                                    print("--- FOUND ROW ---")
                                    for col in row.findall('.//{http://www.nexacroplatform.com/platform/dataset}Col'):
                                        print(f"{col.attrib.get('id')}: {col.text}")
                except Exception as e:
                    print("Error parsing XML", e)
        page.on("response", log_response)
        
        await page.goto('https://aq.hira.or.kr/hira_aq/index.jsp', wait_until='networkidle')
        await asyncio.sleep(3)
        await browser.close()

asyncio.run(main())
