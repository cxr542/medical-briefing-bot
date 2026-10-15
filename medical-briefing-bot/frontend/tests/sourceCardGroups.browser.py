"""Offline UI regression: python tests/sourceCardGroups.browser.py (Playwright + Chromium).
Creates a temporary fixture route, serves the real component and mocks /api/articles.
Never connects to the database. Removes the route and baseline component on exit.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
OUTPUT = ROOT / 'docs/mb-005'
BASE = 'f0f17655c9cd356f861e6a94e41d7faeed60cb7a'
route = ROOT / 'src/app/mb005-fixture'
baseline = ROOT / 'src/components/MB005Baseline.tsx'
assert not route.exists() and not baseline.exists(), 'Temporary test paths already exist'
sources = re.findall(r"^  '([^']+)':", (ROOT / 'src/lib/sourceCardGroups.ts').read_text(), re.M)
rows = [dict(id=i + 1, source=source, title=f'MB005 검증 기사 {i + 1}',
             url=f'https://example.test/article/{i + 1}', published_date='2026-10-15T00:00:00+09:00',
             created_at='2026-10-15T00:00:00+09:00', status='NEW') for i, source in enumerate(sources)]
rows += [{**rows[0], 'id': 23, 'title': 'MB005 추가 기사', 'url': 'https://example.test/article/23'}]
OUTPUT.mkdir(parents=True, exist_ok=True)
server = None
try:
    baseline.write_bytes(subprocess.check_output(['git', 'show', f'{BASE}:medical-briefing-bot/frontend/src/components/ArticleList.tsx'], cwd=REPO))
    route.mkdir()
    (route / 'page.tsx').write_text('''import ArticleList from '@/components/ArticleList';
import Baseline from '@/components/MB005Baseline';
export default async function Fixture({searchParams}: {searchParams: Promise<{baseline?: string}>}) {
 const Component = (await searchParams).baseline ? Baseline : ArticleList;
 return <main className="mx-auto w-full max-w-[1600px] p-4 md:p-8"><Component initialArticles={''' + json.dumps(rows, ensure_ascii=False) + '''} initialDate="2026-10-15" initialTime="17:07" /></main>;
}''')
    with open('/tmp/mb005-server.log', 'w') as log:
        server = subprocess.Popen(['npm', 'run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '3105'], cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
    for attempt in range(90):
        try:
            urlopen('http://127.0.0.1:3105/mb005-fixture', timeout=2)
            break
        except Exception:
            if server.poll() is not None:
                raise RuntimeError(Path('/tmp/mb005-server.log').read_text())
            time.sleep(1)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1100})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        def api(request):
            from urllib.parse import parse_qs, urlparse
            search = parse_qs(urlparse(request.request.url).query).get('search', [''])[0]
            request.fulfill(json={'articles': [row for row in rows if search in row['title']]})
        page.route('**/api/articles?*', api)
        page.add_init_script('window.print = () => {window.__printed = true}')
        def visit(query=''):
            page.goto('http://127.0.0.1:3105/mb005-fixture' + query)
            page.wait_for_timeout(900)
        def download():
            with page.expect_download() as event:
                page.get_by_role('button', name='엑셀 다운로드').click()
            return Path(event.value.path()).read_bytes()
        visit('?baseline=1')
        old_cards = page.locator('button').filter(has=page.locator('div.text-2xl'))
        old_names = old_cards.locator('div.text-xs').all_text_contents()
        old_counts = old_cards.locator('div.text-2xl').all_text_contents()
        old_filters = page.locator('button.rounded-full').all_text_contents()
        old_csv = download()
        visit()
        dashboard = page.get_by_label('출처별 수집 건수', exact=True)
        expect(dashboard.locator('button')).to_have_count(22)
        sections = dashboard.locator('section')
        expect(sections).to_have_count(2)
        expect(sections.nth(0).locator('button')).to_have_count(15)
        expect(sections.nth(1).locator('button')).to_have_count(7)
        assert page.locator('button.rounded-full').all_text_contents() == old_filters
        current = dict(zip(dashboard.locator('button div.text-xs').all_text_contents(), dashboard.locator('button div.text-2xl').all_text_contents()))
        assert current == dict(zip(old_names, old_counts))
        for section in sections.all():
            names = section.locator('button div.text-xs').all_text_contents()
            assert names == [name for name in old_names if name in names]
        assert download() == old_csv, 'CSV output changed'
        for source in sources:
            card = dashboard.get_by_role('button', name=re.compile(re.escape(source) + r'\s*\d+건$'))
            card.click()
            expect(card).to_have_class(re.compile('bg-blue-600'))
            filters = page.get_by_role('heading', name='수집 출처 필터링').locator('../..')
            assert filters.locator('button.rounded-full').evaluate_all("els => els.filter(el => el.classList.contains('bg-[#1D4ED8]')).length") == 1
        # Select an institution, search, check the mocked response reaches the article list.
        dashboard.get_by_role('button', name=re.compile(r'^건보공단 업무포탈\s*2건$')).click()
        search = page.get_by_placeholder('기사 제목, 키워드 검색...')
        search.fill('MB005 추가 기사')
        page.wait_for_timeout(900)
        expect(page.get_by_text('MB005 추가 기사', exact=True).first).to_be_visible()
        expect(dashboard.get_by_role('button', name=re.compile(r'^건보공단 업무포탈\s*2건$'))).to_be_visible()
        search.fill('')
        page.wait_for_timeout(900)
        page.get_by_role('button', name='건보공단 업무포탈', exact=True).first.click()
        expect(page.get_by_text('선택된 출처가 없습니다. 상단 메뉴에서 출처를 선택해주세요.')).to_be_visible()
        page.get_by_role('button', name='기본 선택', exact=True).click()
        page.get_by_role('button', name='리포트 인쇄').click()
        assert page.evaluate('window.__printed') is True
        for width in [1440, 768, 390, 375]:
            page.set_viewport_size({'width': width, 'height': 1100})
            dashboard.scroll_into_view_if_needed()
            page.add_style_tag(content='nextjs-portal { display: none !important; }')
            assert dashboard.bounding_box()['width'] <= width, f'Cards wider than viewport at {width}'
            assert dashboard.evaluate('(el) => el.scrollWidth <= el.clientWidth'), f'Card overflow at {width}'
            assert dashboard.locator('button').count() == 22
            if width in [1440, 390]:
                dashboard.screenshot(path=str(OUTPUT / f'cards-{width}.png'))
        page.emulate_media(media='print')
        expect(dashboard).to_be_hidden()
        page.pdf(path=str(OUTPUT / 'print-verification.pdf'))
        assert not errors, errors
        browser.close()
    print('PASS: 22/15/7, unique identities/order/count parity, 22 card clicks, filter/search, byte-identical CSV, print, widths 1440/768/390/375, no browser errors')
finally:
    if server is not None:
        import signal
        os.killpg(server.pid, signal.SIGTERM)
        server.wait(timeout=15)
    import shutil
    shutil.rmtree(route, ignore_errors=True)
    baseline.unlink(missing_ok=True)
    # Next's generated dev route types reference the removed temporary page.
    shutil.rmtree(ROOT / '.next/dev/types', ignore_errors=True)
