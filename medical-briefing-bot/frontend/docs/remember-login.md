# Support request #4: remember login

## Behavior

- General users may explicitly select 로그인 유지 (unchecked by default).
- Selected: persistent HttpOnly, Secure, SameSite=Lax, host-only session cookie,
  30 days from login or the latest visible-page session renewal.
- Unselected: existing fixed 8-hour session. Admins remain fixed at 1 hour.
- Existing CustomerSession checks on mount, page return, focus and every minute
  POST to the same-origin session endpoint while visible. Hidden checks are GET
  and never extend the session. A browser that clears site data/private browsing
  can remove the cookie before its expiry.
- Passwords are never saved in localStorage, sessionStorage or the cookie.
  The existing random token is stored only as its SHA-256 digest in the DB.
- Logout revokes the token and clears the cookie. Expired, disabled, revoked and
  stale credential/principal-version sessions cannot renew.
- No automatic migration of existing 8-hour sessions: users must log in again
  with the checkbox selected to opt in.

## Release order

1. Apply repository-root `supabase/migrations/20261029093624_customer_remember_login.sql`
   to the reviewed application DB. Existing application versions remain compatible.
2. Deploy the frontend containing customer_session_rpc routing and session POST.
3. On a personal PC, log in with 로그인 유지 selected. Close/reopen the browser
   and revisit. Confirm session POST returns 200 with a persistent cookie.
4. Log out, revisit the protected page and confirm it redirects to login.
5. Check ordinary login and customer-admin login still retain their fixed TTLs.

Rollback: deploy the previous frontend first. Remembered sessions remain valid
until their current expiry, logout, account disable or credential rotation.
Do not drop the added columns/function until no deployed version uses them.
To revoke remembered sessions during rollback, explicitly revoke only rows with
remember=true through a separately authorized operation.

## Verification

- `npm run build -- --webpack`: PASS against main c33bdb6.
- `node --experimental-strip-types --test tests/*.test.mjs`: 263 PASS before
  the additional checkbox payload regression test; that 2-test suite also PASS.
- `node --test tests/remember-login-http.mjs`: 3 PASS against production Next
  routes and the real SQL implementation in local PGlite, no remote credentials.
- `npx tsc --noEmit` and ESLint on changed TypeScript files: PASS.
- Actual Chrome: default checkbox off, selectable, desktop and 390px mobile
  layout inspected. Supporting Korean text wraps without overflow; native
  checkbox retains keyboard focus and the PWA install helper remains present.

## Customer reply draft (not posted)

로그인 화면에 로그인 유지 옵션을 추가했습니다. 개인 PC에서 선택하여
로그인하면 마지막 이용부터 30일간 유지되며, 이용 중 기간이 갱신됩니다.
비밀번호를 저장하지 않는 서버 세션 방식입니다. 로그아웃하면 유지 상태가
해제됩니다. 계정 비활성화 또는 공용 비밀번호 변경 시에도 다시 로그인해야
합니다. 기존 로그인에는 자동 적용되지 않으므로 새 옵션을 선택해 다시
로그인해 주세요. 브라우저 쿠키 삭제나 시크릿 모드에서는 유지되지 않을 수
있습니다. (운영 배포 완료 후 게시)
