export type PrincipalKind = 'user' | 'admin';
export type Principal = { id: string; kind: PrincipalKind };
export type AuthRecord = { id?: string; active?: boolean; password_hash?: string; credential_version?: number; session_version?: number; allowed?: boolean; ok?: boolean; remember?: boolean; expires_at?: string };
export interface AuthRepository { call(operation: string, payload: Record<string, unknown>): Promise<AuthRecord | null> }
export const LOGIN_FAILURE: string;
export const ADMIN_LOGIN_FAILURE: string;
export const SESSION_TTL: Record<PrincipalKind, number>;
export const REMEMBER_TTL: number;
export const COOKIE_NAMES: Record<PrincipalKind, string>;
export function validPassword(value: unknown): boolean;
export function hashPassword(value: string): Promise<string>;
export function verifyPassword(encoded: unknown, candidate: unknown): Promise<boolean>;
export function tokenHash(token: string): string;
export function cookieName(kind: PrincipalKind, secure?: boolean): string;
export function readSessionCookie(request: Request, kind: PrincipalKind, secure?: boolean): string | null;
export function sessionCookie(kind: PrincipalKind, token: string, secure?: boolean, clear?: boolean, maxAge?: number): string;
export function rateKeys(kind: PrincipalKind, identifier: string, ip: string, secret: string): { ip: string; identity: string };
export class CustomerAuthService {
  constructor(repository: AuthRepository);
  login(kind: PrincipalKind, identifier: unknown, password: unknown, keys: { ip: string; identity: string }, remember?: boolean): Promise<{ status: number; error?: string; token?: string; principal?: Principal }>;
  refresh(token: string | null): Promise<{ principal: Principal; expiresAt: string | null | undefined } | null>;
  authorize(kind: PrincipalKind, token: string | null): Promise<Principal | null>;
  logout(kind: PrincipalKind, token: string | null): Promise<void>;
  setUserActive(adminToken: string, userId: string, active: boolean): Promise<Record<string, unknown> | null>;
  changeSharedPassword(adminToken: string, password: string): Promise<Record<string, unknown> | null>;
}
