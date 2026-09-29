import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const ADMIN_SESSION_COOKIE_NAME = 'medical_briefing_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const ADMIN_PASSWORD_MIN_BYTES = 32;
export const ADMIN_AUTH_FAILURE_REASON = Object.freeze({
  PASSWORD_ENV_MISSING: 'PASSWORD_ENV_MISSING',
  PASSWORD_ENV_TOO_SHORT: 'PASSWORD_ENV_TOO_SHORT',
  REQUEST_PASSWORD_INVALID: 'REQUEST_PASSWORD_INVALID',
  PASSWORD_LENGTH_MISMATCH: 'PASSWORD_LENGTH_MISMATCH',
  PASSWORD_MISMATCH: 'PASSWORD_MISMATCH',
  SESSION_CREATION_FAILED: 'SESSION_CREATION_FAILED',
  OTHER: 'OTHER',
});

const SESSION_VERSION = 'v1';
const SESSION_KEY_CONTEXT = 'medical-briefing-admin-session-signing-key-v1';

const getSigningKey = password => {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < ADMIN_PASSWORD_MIN_BYTES) {
    return null;
  }

  return createHmac('sha256', password).update(SESSION_KEY_CONTEXT).digest();
};

const safeEqual = (left, right) => (
  left.length === right.length && timingSafeEqual(left, right)
);

export function isAdminCredentialConfigured(password = process.env.ADMIN_PASSWORD) {
  return getSigningKey(password) !== null;
}

export function inspectAdminCredential(candidate, configuredPassword = process.env.ADMIN_PASSWORD) {
  const envPresent = typeof configuredPassword === 'string';
  const configured = envPresent ? configuredPassword : '';
  const requestPasswordType = typeof candidate === 'string' ? 'string' : 'other';
  const submitted = typeof candidate === 'string' ? candidate : '';
  const configuredByteLength = Buffer.byteLength(configured, 'utf8');
  const requestByteLength = requestPasswordType === 'string'
    ? Buffer.byteLength(submitted, 'utf8')
    : null;
  const configuredDigest = createHmac('sha256', 'admin-password-comparison-v1')
    .update(configured)
    .digest();
  const submittedDigest = createHmac('sha256', 'admin-password-comparison-v1')
    .update(submitted)
    .digest();
  const comparisonResult = safeEqual(submittedDigest, configuredDigest);
  const lengthMatch = envPresent
    && requestByteLength !== null
    && configuredByteLength === requestByteLength;

  let failureReason = null;
  if (!envPresent) {
    failureReason = ADMIN_AUTH_FAILURE_REASON.PASSWORD_ENV_MISSING;
  } else if (configuredByteLength < ADMIN_PASSWORD_MIN_BYTES) {
    failureReason = ADMIN_AUTH_FAILURE_REASON.PASSWORD_ENV_TOO_SHORT;
  } else if (typeof candidate !== 'string' || candidate.length > 512) {
    failureReason = ADMIN_AUTH_FAILURE_REASON.REQUEST_PASSWORD_INVALID;
  } else if (!lengthMatch) {
    failureReason = ADMIN_AUTH_FAILURE_REASON.PASSWORD_LENGTH_MISMATCH;
  } else if (!comparisonResult) {
    failureReason = ADMIN_AUTH_FAILURE_REASON.PASSWORD_MISMATCH;
  }

  return {
    envPresent,
    configuredByteLength,
    requestPasswordType,
    requestByteLength,
    lengthMatch,
    comparisonResult,
    failureReason,
  };
}

export function logPreviewAdminAuthDiagnostic(diagnostic) {
  if (process.env.VERCEL_ENV !== 'preview') return;

  const failureReason = Object.values(ADMIN_AUTH_FAILURE_REASON).includes(diagnostic.failureReason)
    ? diagnostic.failureReason
    : ADMIN_AUTH_FAILURE_REASON.OTHER;
  const safeDiagnostic = {
    envPresent: diagnostic.envPresent === true,
    configuredByteLength: Number.isSafeInteger(diagnostic.configuredByteLength)
      ? diagnostic.configuredByteLength
      : 0,
    requestPasswordType: diagnostic.requestPasswordType === 'string' ? 'string' : 'other',
    ...(Number.isSafeInteger(diagnostic.requestByteLength)
      ? { requestByteLength: diagnostic.requestByteLength }
      : {}),
    lengthMatch: diagnostic.lengthMatch === true,
    comparisonResult: diagnostic.comparisonResult === true,
    failureReason,
  };

  console.info('[admin-auth-diagnostic]', safeDiagnostic);
}

export function verifyAdminCredential(candidate, configuredPassword = process.env.ADMIN_PASSWORD) {
  return inspectAdminCredential(candidate, configuredPassword).failureReason === null;
}

export function createAdminSessionToken(
  password = process.env.ADMIN_PASSWORD,
  now = Date.now(),
  nonce = randomBytes(16).toString('base64url'),
) {
  const key = getSigningKey(password);
  if (!key || !Number.isFinite(now) || !/^[A-Za-z0-9_-]{22}$/.test(nonce)) return null;

  const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const payload = `${SESSION_VERSION}.${expiresAt}.${nonce}`;
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyAdminSessionToken(
  token,
  password = process.env.ADMIN_PASSWORD,
  now = Date.now(),
) {
  if (typeof token !== 'string' || token.length > 160 || !Number.isFinite(now)) return false;

  const [version, expiresAtText, nonce, signature, extra] = token.split('.');
  if (extra !== undefined
    || version !== SESSION_VERSION
    || !/^\d{10}$/.test(expiresAtText || '')
    || !/^[A-Za-z0-9_-]{22}$/.test(nonce || '')
    || !/^[A-Za-z0-9_-]{43}$/.test(signature || '')) {
    return false;
  }

  const key = getSigningKey(password);
  if (!key) return false;

  const expiresAt = Number(expiresAtText);
  const nowSeconds = Math.floor(now / 1000);
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + ADMIN_SESSION_TTL_SECONDS) return false;

  const payload = `${version}.${expiresAtText}.${nonce}`;
  const expected = createHmac('sha256', key).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  return received.length === expected.length && safeEqual(received, expected);
}

export function getAdminSessionToken(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;

  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== ADMIN_SESSION_COOKIE_NAME) continue;
    const value = entry.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}

export function isAdminRequestAuthorized(request, now = Date.now()) {
  const token = getAdminSessionToken(request.headers.get('cookie'));
  return verifyAdminSessionToken(token, process.env.ADMIN_PASSWORD, now);
}

export function hasSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    const suppliedOrigin = new URL(origin);
    if (suppliedOrigin.protocol !== 'http:' && suppliedOrigin.protocol !== 'https:') return false;

    const requestUrl = new URL(request.url);
    const host = request.headers.get('host');
    if (process.env.NODE_ENV === 'production') {
      return suppliedOrigin.protocol === 'https:'
        && host !== null
        && suppliedOrigin.host.toLowerCase() === host.toLowerCase();
    }

    return suppliedOrigin.origin === requestUrl.origin
      || (host !== null
        && suppliedOrigin.protocol === requestUrl.protocol
        && suppliedOrigin.host.toLowerCase() === host.toLowerCase());
  } catch {
    return false;
  }
}

export function serializeAdminSessionCookie(token, secure = process.env.NODE_ENV === 'production') {
  const attributes = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function serializeClearedAdminSessionCookie(secure = process.env.NODE_ENV === 'production') {
  const attributes = [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}
