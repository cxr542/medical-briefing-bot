// Test subprocess only. Production always connects to smtp.gmail.com over verified TLS.
import nodemailer from 'nodemailer';
const originalTransport = nodemailer.createTransport;
nodemailer.createTransport = options => originalTransport({ ...options, host: '127.0.0.1', port: Number(process.env.SUPPORT_TEST_SMTP_PORT), secure: false, ignoreTLS: true });
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.pathname.startsWith('/rest/v1/rpc/')) return originalFetch(new Request(new URL(url.pathname, process.env.SUPPORT_TEST_MAIL_ORIGIN), new Request(input, init)));
  return originalFetch(input, init);
};
