import { test, expect } from '@playwright/test';
import { TOKEN_A, ADMIN_A } from '../fixtures/supportDatabase.mjs';
import { cookieName } from '../../src/lib/customer-auth/core.mjs';
import { createAdminSessionToken, ADMIN_SESSION_COOKIE_NAME } from '../../src/lib/adminAuth.mjs';

const ID = '33333333-3333-4333-8333-333333333333';
const when = '2026-10-16T02:00:00Z';
const request = { id: ID, request_number: 6, title: '모바일 브리핑 확인 요청', description: '<img src=x onerror=alert(1)>\n화면을 확인해 주세요.',
  status: 'received', priority: 'normal', version: 1, created_at: when, updated_at: when, closed_at: null };
async function login(context, audience = 'customer') {
  const internal = audience === 'internal';
  await context.addCookies([{ name: internal ? ADMIN_SESSION_COOKIE_NAME : cookieName('admin', true),
    value: internal ? createAdminSessionToken('ui-local-internal-password-123456') : TOKEN_A, url: internal ? 'http://127.0.0.1:3027' : 'https://127.0.0.1/', secure: !internal, httpOnly: true }]);
}
async function mock(page, { failure = 0, conflict = false, empty = false, holdCreate, failAfterSave = false } = {}) {
  let current = { ...request };
  let comments = [];
  let notes = [];
  let history = [{ id: ID, previous_status: null, new_status: 'received', reason: '요청 접수', changed_by: ADMIN_A, actor_type: 'customer_admin', created_at: when }];
  let audit = [{ id: ID, action: 'request_created', actor_type: 'customer_admin', actor_id: 'synthetic-session', created_at: when }];
  const calls = [];
  await page.route(/\/api\/(?:customer-admin|admin)\/support\/requests/, async route => {
    const input = route.request(); const url = new URL(input.url());
    calls.push({ method: input.method(), url, body: input.postDataJSON() });
    if (url.pathname.includes('/attachments')) return route.fulfill({ json: { attachments: [] } });
    if (failure) return route.fulfill({ status: failure, json: { error: failure === 503 ? 'SUPPORT_DISABLED' : 'TEST_ERROR' } });
    const internal = url.pathname.startsWith('/api/admin/');
    const item = () => internal ? { ...current, requester_admin_id: ADMIN_A } : current;
    if (input.method() === 'GET') {
      if (url.pathname.endsWith('/requests')) {
        const rows = empty || url.searchParams.get('page') === '2' || (url.searchParams.get('status') && url.searchParams.get('status') !== current.status) ? [] : [item()];
        return route.fulfill({ json: { requests: rows, total: empty ? 0 : 11, page: Number(url.searchParams.get('page')), page_size: 10 } });
      }
      return route.fulfill({ json: { request: item(), comments, comments_total: comments.length, page: 1, page_size: 10,
        ...(internal ? { notes, notes_total: notes.length, history, history_total: history.length, audit, audit_total: audit.length } : {}) } });
    }
    const body = input.postDataJSON();
    if (url.pathname.endsWith('/requests')) {
      if (holdCreate) await holdCreate;
      current = { ...current, ...body };
      return route.fulfill({ status: 201, json: { request: current } });
    }
    if (conflict) {
      conflict = false; current = { ...current, status: 'reviewing', version: 2 };
      return route.fulfill({ status: 409, json: { error: 'VERSION_CONFLICT' } });
    }
    if (body.version !== current.version) return route.fulfill({ status: 409, json: { error: 'VERSION_CONFLICT' } });
    const operation = url.pathname.split('/').at(-1);
    if (operation === 'status') {
      if (current.status === 'received' && body.status === 'completed') return route.fulfill({ status: 400, json: { error: 'INVALID_INPUT' } });
      history = [{ ...history[0], id: crypto.randomUUID(), previous_status: current.status, new_status: body.status, reason: body.reason }, ...history];
      current = { ...current, status: body.status };
    } else if (operation === 'comments') comments = [{ id: crypto.randomUUID(), author_type: 'internal_admin', body: body.body, created_at: when }, ...comments];
    else notes = [{ id: crypto.randomUUID(), body: body.body, actor_id: 'synthetic-session', created_at: when }, ...notes];
    audit = [{ ...audit[0], id: crypto.randomUUID(), action: operation === 'status' ? 'status_changed' : operation === 'comments' ? 'comment_created' : 'note_created' }, ...audit];
    current = { ...current, version: current.version + 1 };
    if (failAfterSave) failure = 503;
    return route.fulfill({ status: operation === 'status' ? 200 : 201, json: { request: item() } });
  });
  return calls;
}
async function openDetail(page, audience = 'customer') {
  await page.goto(audience === 'customer' ? '/customer-admin/support' : '/admin/support');
  await page.getByRole('button', { name: '요청 #6 상세 보기' }).click();
  await expect(page.getByRole('heading', { name: request.title })).toBeVisible();
}

test('customer list, filter, pagination, safe detail and no internal controls', async ({ page, context }) => {
  await login(context); const calls = await mock(page);
  await openDetail(page);
  await expect(page.getByText(request.description)).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(0);
  await expect(page.getByText('내부 메모', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '공개 답변 등록' })).toHaveCount(0);
  await page.getByRole('button', { name: '목록으로' }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByText('등록된 요청이 없습니다')).toBeVisible();
  await page.getByLabel('처리 상태', { exact: true }).selectOption('completed');
  await expect.poll(() => calls.at(-1)?.url.searchParams.get('status')).toBe('completed');
  expect(calls.every(call => call.url.pathname.startsWith('/api/customer-admin/'))).toBe(true);
});

test('customer creates request with validation, focus and duplicate submission protection', async ({ page, context }) => {
  await login(context); const calls = await mock(page);
  await page.goto('/customer-admin/support');
  await page.getByRole('button', { name: '새 요청 등록' }).click();
  await expect(page.getByLabel('제목 (필수)')).toBeFocused();
  await page.getByLabel('제목 (필수)').fill('새 지원 요청');
  await page.getByLabel('상세 내용 (필수)').fill('문제 발생 상황입니다.');
  await page.getByLabel('우선순위', { exact: true }).selectOption('high');
  await page.getByRole('button', { name: '요청 등록', exact: true }).click();
  await expect(page.getByText('기술지원 요청을 등록했습니다.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '새 지원 요청' })).toBeVisible();
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
  expect(calls.find(call => call.method === 'POST').body).toEqual({ title: '새 지원 요청', description: '문제 발생 상황입니다.', priority: 'high' });
});

test('internal changes status, rejects invalid transition, adds public answer and private note', async ({ page, context }) => {
  await login(context, 'internal'); await mock(page); await openDetail(page, 'internal');
  await page.getByLabel('변경할 상태').selectOption('completed');
  await page.getByLabel('변경 사유').fill('직접 완료 시도');
  await page.getByRole('button', { name: '상태 변경', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('입력 내용 또는 상태 변경');
  await page.getByLabel('변경할 상태').selectOption('reviewing');
  await page.getByRole('button', { name: '상태 변경', exact: true }).click();
  await expect(page.getByText('처리 상태를 변경했습니다.')).toBeVisible();
  await page.getByLabel('답변 내용').fill('공개 답변입니다.');
  await page.getByRole('button', { name: '공개 답변 등록', exact: true }).click();
  await expect(page.getByText('공개 답변입니다.', { exact: true })).toBeVisible();
  await page.getByLabel('메모 내용').fill('내부 전용 메모입니다.');
  await page.getByRole('button', { name: '내부 메모 등록', exact: true }).click();
  await expect(page.getByText('내부 전용 메모입니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '감사 이력' })).toBeVisible();
});

test('409 reloads latest state, preserves input and requires acknowledgement', async ({ page, context }) => {
  await login(context, 'internal'); const calls = await mock(page, { conflict: true }); await openDetail(page, 'internal');
  await page.getByLabel('메모 내용').fill('보존할 입력');
  await page.getByRole('button', { name: '내부 메모 등록', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('입력 내용은 보존했습니다');
  await expect(page.getByLabel('메모 내용')).toHaveValue('보존할 입력');
  await expect(page.getByRole('button', { name: '내부 메모 등록', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '최신 내용을 확인했습니다' }).click();
  await page.getByRole('button', { name: '내부 메모 등록', exact: true }).click();
  await expect(page.getByText('보존할 입력', { exact: true })).toBeVisible();
  expect(calls.filter(call => call.method === 'POST').at(-1).body.version).toBe(2);
});

for (const status of [400, 401, 403, 404, 503]) test(`API ${status} shows safe actionable error without stale rows`, async ({ page, context }) => {
  await login(context); await mock(page, { failure: status }); await page.goto('/customer-admin/support');
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  if (status === 401) await expect(page.getByRole('link', { name: '다시 로그인' })).toBeVisible();
  if (status === 503) await expect(page.locator('main').getByRole('alert')).toContainText('아직 활성화되지 않았습니다');
  await expect(page.getByRole('button', { name: '요청 #6 상세 보기' })).toHaveCount(0);
});

test('disabled server shows no fake requests and keeps account navigation', async ({ page, context }) => {
  await login(context); let supportCalls = 0;
  await page.route(/\/api\/.*\/support\//, route => { supportCalls++; return route.abort(); });
  await page.goto('http://127.0.0.1:3028/customer-admin/support');
  await expect(page.getByRole('heading', { name: '기술지원 기능 준비 중' })).toBeVisible();
  await expect(page.getByRole('link', { name: '계정 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '새 요청 등록' })).toHaveCount(0);
  expect(supportCalls).toBe(0);
});

test('pages reject anonymous ordinary employee and opposite admin sessions', async ({ page, context }) => {
  await page.goto('/customer-admin/support'); await expect(page).toHaveURL(/customer-admin\/login/);
  await context.addCookies([{ name: cookieName('user', true), value: 'u'.repeat(43), url: 'https://127.0.0.1/', secure: true }]);
  await page.goto('/customer-admin/support'); await expect(page).toHaveURL(/customer-admin\/login/);
  await login(context); await page.goto('/admin/support'); await expect(page).toHaveURL(/\/admin$/);
  await context.clearCookies(); await login(context, 'internal');
  await page.goto('/customer-admin/support'); await expect(page).toHaveURL(/customer-admin\/login/);
});

test('phone and tablet reflow, keyboard dialog cancellation and empty state', async ({ page, context }) => {
  await login(context); await mock(page, { empty: true });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto('/customer-admin/support');
    await expect(page.getByText('등록된 요청이 없습니다')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '새 요청 등록' }).click(); await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '새 요청 등록' })).toBeFocused();
  }
});

test('in-flight create disables controls and ignores a second form submission', async ({ page, context }) => {
  await login(context);
  let release;
  const holdCreate = new Promise(resolve => { release = resolve; });
  const calls = await mock(page, { holdCreate });
  await page.goto('/customer-admin/support');
  await page.getByRole('button', { name: '새 요청 등록' }).click();
  await page.getByLabel('제목 (필수)').fill('중복 등록 확인');
  await page.getByLabel('상세 내용 (필수)').fill('등록 중 입력을 확인합니다.');
  await page.getByRole('button', { name: '요청 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '등록 중…' })).toBeDisabled();
  await page.locator('dialog form').evaluate(form => form.requestSubmit());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  release();
  await expect(page.getByText('기술지원 요청을 등록했습니다.')).toBeVisible();
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
});

test('customer account management stays usable with the new support navigation', async ({ page, context }) => {
  await login(context); await mock(page);
  await page.route(/\/api\/customer-admin\/(users|audit|session)/, route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.pathname.endsWith('/users') ? {
      users: [{ id: ADMIN_A, employee_number: 'TEST1001', active: true, created_at: when, updated_at: when, disabled_at: null }],
      total: 1, page: 1, page_size: 10, stats: { total: 1, active: 1, inactive: 0 },
      admin: { id: ADMIN_A, login_id: 'test-admin', designation: '담당자' }, credential: { configured: true, updated_at: when },
    } : { events: [], total: 0, page: 1, page_size: 6 } });
  });
  await page.goto('/customer-admin');
  await expect(page.getByRole('heading', { name: '사용자 관리' })).toBeVisible();
  await page.getByRole('button', { name: '사번 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '기술지원 요청', exact: true }).click();
  await expect(page.getByRole('heading', { name: '기술지원 요청', exact: true })).toBeVisible();
});

test('successful save followed by failed refresh is not reported as a failed save', async ({ page, context }) => {
  await login(context, 'internal'); const calls = await mock(page, { failAfterSave: true });
  await openDetail(page, 'internal');
  await page.getByLabel('메모 내용').fill('저장은 성공한 메모');
  await page.getByRole('button', { name: '내부 메모 등록', exact: true }).click();
  await expect(page.getByText('저장했습니다. 최신 내용을 다시 불러와 주세요.')).toBeVisible();
  await expect(page.getByLabel('메모 내용')).toHaveCount(0);
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
});
