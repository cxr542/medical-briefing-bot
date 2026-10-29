// Test subprocess only: keep production's fixed Resend URL and redirect at the network boundary.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin === 'https://api.resend.com' || url.pathname.startsWith('/rest/v1/rpc/')) {
    return originalFetch(new Request(new URL(url.pathname, process.env.SUPPORT_TEST_MAIL_ORIGIN), new Request(input, init)));
  }
  return originalFetch(input, init);
};
