import { createHash, randomBytes, createHmac } from 'node:crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';

export const LOGIN_FAILURE = '사번 또는 비밀번호를 확인해 주세요.';
export const ADMIN_LOGIN_FAILURE = '관리자 인증 정보를 확인해 주세요.';
export const SESSION_TTL = { user: 8 * 3600, admin: 3600 };
export const REMEMBER_TTL = 30 * 24 * 3600;
export const COOKIE_NAMES = { user: 'medical_customer_session', admin: 'medical_customer_admin_session' };
const HASH_OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };
// A non-credential fixture hash used only to equalize missing-credential verification.
let dummyHash;
const dummy = () => (dummyHash ??= hash(randomBytes(32).toString('hex'), HASH_OPTIONS));

export function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 512;
}
export async function hashPassword(value) {
  if (!validPassword(value)) throw new Error('Invalid password length');
  return hash(value, HASH_OPTIONS);
}
export async function verifyPassword(encoded, candidate) {
  const bounded = typeof candidate === 'string' && Buffer.byteLength(candidate, 'utf8') <= 512;
  // Never trust parameters in arbitrary/corrupt DB hashes to allocate unbounded memory.
  const validHash = typeof encoded === 'string' && /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.test(encoded);
  const target = validHash ? encoded : await dummy();
  try { return (await verify(target, bounded ? candidate : '', HASH_OPTIONS)) && validHash && bounded; }
  catch { return false; }
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function cookieName(kind, secure = process.env.NODE_ENV === 'production') {
  return `${secure ? '__Host-' : ''}${COOKIE_NAMES[kind]}`;
}
export function readSessionCookie(request, kind, secure = process.env.NODE_ENV === 'production') {
  const name = cookieName(kind, secure);
  const entries = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (entries.length !== 1) return null;
  const token = entries[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export function sessionCookie(kind, token, secure = process.env.NODE_ENV === 'production', clear = false, maxAge = SESSION_TTL[kind]) {
  if (!clear && !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid session token');
  if (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > (kind === 'user' ? REMEMBER_TTL : SESSION_TTL.admin)) throw new Error('Invalid session lifetime');
  return `${cookieName(kind, secure)}=${clear ? '' : token}; Path=/; Max-Age=${clear ? 0 : maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export function rateKeys(kind, identifier, ip, secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('Rate limit configuration unavailable');
  const digest = value => createHmac('sha256', secret).update(value).digest('hex');
  return { ip: digest(JSON.stringify([kind, ip])), identity: digest(JSON.stringify([kind, ip, identifier])) };
}

// Repository is the persistence boundary. No module-level sessions or authorization cache.
export class CustomerAuthService {
  constructor(repository) { this.repository = repository; }
  async login(kind, identifier, password, keys, remember = false) {
    const limit = await this.repository.call('consume_attempt', keys);
    if (!limit.allowed) return { status: 429, error: '잠시 후 다시 시도해 주세요.' };
    const validIdentifier = typeof identifier === 'string' && identifier.length > 0 && identifier.length <= 64 && !/[\s\x00-\x1f\x7f]/.test(identifier);
    const credential = validIdentifier ? await this.repository.call(kind === 'user' ? 'lookup_user' : 'lookup_admin', { identifier }) : null;
    const correct = await verifyPassword(credential?.password_hash, password);
    if (!credential?.active || !correct) {
      if (kind === 'admin') await this.repository.call('audit_admin_failure', {});
      return { status: 401, error: kind === 'user' ? LOGIN_FAILURE : ADMIN_LOGIN_FAILURE };
    }
    const token = randomBytes(32).toString('base64url');
    // Atomic DB recheck prevents a rotation/disable during hash verification from issuing a stale session.
    const issued = await this.repository.call('issue_session', {
      kind, principal_id: credential.id, token_hash: tokenHash(token),
      credential_version: credential.credential_version, principal_version: credential.session_version,
      remember: kind === 'user' && remember === true,
    });
    if (!issued.ok) return { status: 401, error: kind === 'user' ? LOGIN_FAILURE : ADMIN_LOGIN_FAILURE };
    return { status: 200, token, principal: { id: credential.id, kind } };
  }
  async authorize(kind, token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await this.repository.call('validate_session', { kind, token_hash: tokenHash(token) });
    return result?.id ? { id: result.id, kind } : null;
  }
  async refresh(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await this.repository.call('refresh_session', { kind: 'user', token_hash: tokenHash(token) });
    return result?.id ? { principal: { id: result.id, kind: 'user' }, expiresAt: result.remember ? result.expires_at : null } : null;
  }
  async logout(kind, token) {
    if (typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)) await this.repository.call('revoke_session', { kind, token_hash: tokenHash(token) });
  }
  async setUserActive(adminToken, userId, active) {
    if (!await this.authorize('admin', adminToken)) throw new Error('Unauthorized');
    return this.repository.call('set_user_active', { admin_token_hash: tokenHash(adminToken), user_id: userId, active });
  }
  async changeSharedPassword(adminToken, password) {
    if (!await this.authorize('admin', adminToken)) throw new Error('Unauthorized');
    const password_hash = await hashPassword(password);
    return this.repository.call('rotate_shared', { admin_token_hash: tokenHash(adminToken), password_hash });
  }
}
