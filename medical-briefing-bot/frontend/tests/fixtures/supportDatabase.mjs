import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { tokenHash } from '../../src/lib/customer-auth/core.mjs';

export const ADMIN_A = '11111111-1111-4111-8111-111111111111';
export const ADMIN_B = '22222222-2222-4222-8222-222222222222';
export const TOKEN_A = 'a'.repeat(43);
export const TOKEN_B = 'b'.repeat(43);
export const ACTOR = 'c'.repeat(64);
export const migration = await readFile(new URL('../../../supabase/migrations/20261016014502_support_foundation.sql', import.meta.url), 'utf8');

export const authFoundation = `
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA customer_auth;
    CREATE TABLE customer_auth.customer_admins (
      id uuid PRIMARY KEY, active boolean NOT NULL DEFAULT true,
      session_version bigint NOT NULL DEFAULT 1, credential_version bigint NOT NULL DEFAULT 1
    );
    CREATE TABLE customer_auth.customer_sessions (
      token_hash text PRIMARY KEY,kind text NOT NULL,admin_id uuid REFERENCES customer_auth.customer_admins,
      expires_at timestamptz NOT NULL,revoked_at timestamptz,
      principal_version bigint NOT NULL DEFAULT 1,credential_version bigint NOT NULL DEFAULT 1
    );
    CREATE FUNCTION customer_auth.validate_session(p_kind text,p_hash text) RETURNS jsonb
    LANGUAGE sql STABLE SET search_path='' AS $$
      SELECT jsonb_build_object('id',a.id) FROM customer_auth.customer_sessions s
      JOIN customer_auth.customer_admins a ON a.id=s.admin_id
      WHERE s.kind=p_kind AND s.token_hash=p_hash AND s.revoked_at IS NULL AND s.expires_at>now()
        AND a.active AND a.session_version=s.principal_version AND a.credential_version=s.credential_version
    $$;
    GRANT USAGE ON SCHEMA customer_auth TO service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA customer_auth TO service_role;
    GRANT UPDATE ON customer_auth.customer_admins,customer_auth.customer_sessions TO service_role;
    REVOKE EXECUTE ON FUNCTION customer_auth.validate_session(text,text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION customer_auth.validate_session(text,text) TO service_role;
  `;

export async function createDatabase({ apply = true } = {}) {
  const db = new PGlite();
  await db.exec(authFoundation);
  await db.query('INSERT INTO customer_auth.customer_admins(id) VALUES ($1),($2)', [ADMIN_A, ADMIN_B]);
  await db.query("INSERT INTO customer_auth.customer_sessions(token_hash,kind,admin_id,expires_at) VALUES ($1,'admin',$2,now()+interval '1 hour'),($3,'admin',$4,now()+interval '1 hour')", [tokenHash(TOKEN_A), ADMIN_A, tokenHash(TOKEN_B), ADMIN_B]);
  if (apply) await db.exec(migration);
  return db;
}

export async function rpc(db, audience, operation, payload = {}) {
  const name = audience === 'customer' ? 'customer_support_rpc' : 'admin_support_rpc';
  return db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE service_role');
    const { rows } = await tx.query(`SELECT public.${name}($1,$2::jsonb) AS data`, [operation, JSON.stringify(payload)]);
    return rows[0].data;
  });
}

export const customerPayload = (extra = {}, token = TOKEN_A) => ({ ...extra, admin_token_hash: tokenHash(token) });
export const internalPayload = (extra = {}) => ({ ...extra, actor_id: ACTOR });
export const create = db => rpc(db, 'customer', 'create', customerPayload({ title: 'Test request', description: 'Test details', priority: 'normal' }));
