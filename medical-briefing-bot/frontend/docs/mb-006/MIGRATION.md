# Support foundation migration and rollback

## Baseline and production restrictions

Baseline main: `225981064becc41ec4a1ee6f8dbe57dbd0ff08e8`.
Initial workspace branch: `fix/collector-schedule-offset`, HEAD `548ee2c88905b40d6831352ddfcc405d0f7f8cec`, dirty; preserved unchanged. Implementation uses isolated `feat/mb-006-support-foundation`.
Open PRs at baseline: #90 release note, #55 LAW credentials, #54 collector health, #38 release documentation.

Read-only production metadata checks confirmed the existing customer auth schema, `customer_auth.validate_session(text,text)`, and public customer RPC wrappers. The existing validation checks active admin, session expiry/revocation and credential/principal versions. Database migration history contains only:

- 20260928064906 collector_alert_state
- 20260929063328 20260928010000_collector_runs_admin_only
- 20261007041102 article_keyword_boundary
- 20261012043225 article_source_detail_url

The repository does not carry those migrations or the complete auth foundation. This PR does not pretend to repair that history. Its migration is an additive increment for a database with the existing auth foundation, not a complete blank-project bootstrap. It never creates, alters or deletes existing authentication tables/functions/data.

Production migration, Secrets, deployment and activation are not authorized by this PR. Do not run `supabase db push`, reset, link, repair, or apply_migration against Production. No bucket or initial MB-001..005 data is created.

## Preflight for a separately approved rollout

1. Reconcile migration history through a separately reviewed baseline process before using a bulk CLI deployment. Do not mark missing migrations as applied without proving schema equivalence.
2. Verify the target is the approved database; take and verify an appropriate backup.
3. Verify `customer_auth.customer_admins` contains `id, active, credential_version, session_version`; sessions contain `admin_id, kind, token_hash, expires_at, revoked_at, principal_version, credential_version`.
4. Verify the existing validate_session function and service_role read/update/execute privileges. Row locking requires existing update privileges; the support migration does not widen auth grants.
5. Confirm `support` schema and both new public RPC names do not exist. Migration fails on conflicts rather than overwriting them.
6. Keep `SUPPORT_ENABLED=false`. Run the exact reviewed SQL in a single controlled migration transaction after explicit approval, recording its version and checksum in the reconciled deployment process.
7. Verify five tables, FORCE RLS, role grants, functions, ownership isolation and existing login/account management before any later activation.

## Local validation

From `medical-briefing-bot/frontend`:

```sh
npm ci
npm test
npm run test:support:http
```

The tests create a separate in-memory PostgreSQL WASM database using pinned PGlite, never an external Supabase database. A synthetic auth fixture implements the previously observed Customer Admin validation contract; it contains no production account data, password hashes or credentials. Migration SQL is executed unmodified, including roles, ACLs, RLS, PL/pgSQL, row locks, transactions, triggers and rollback behavior.

The HTTP suite starts a loopback RPC adapter backed by this real database, builds Next with that adapter's temporary address, then exercises real production route handlers. The adapter is not PostgREST; managed Supabase/PostgREST behavior and native multi-connection lock scheduling remain staging acceptance checks. Concurrent HTTP requests prove optimistic version conflict behavior; PGlite serializes database connections.

## Re-run, failure and rollback

The migration has explicit BEGIN/COMMIT and aborts if prerequisite auth objects are missing or support objects already exist. Reapplying is intentionally rejected; it is not an idempotent overwrite script. Use migration history to execute once. Mid-script errors require ROLLBACK on the same session; transactional DDL leaves existing auth objects unchanged. Tests inject a failure and prove recovery.

Primary rollback: set SUPPORT_ENABLED=false under separately approved environment change, then revert application commits as needed. Preserve support tables and history once data exists. Disabled endpoints still authenticate and return no support data.

`supabase/rollback/support_foundation_empty_only.sql` is a separately approved, destructive removal option only for a deployment with zero requests. It rejects populated support data. It drops only support RPCs/schema; it does not touch customer_auth. Test databases exercise both the empty rollback and populated refusal. Do not run it on Production in this phase. Before future removal, check dependencies/backups and reconcile the recorded migration version; do not blindly rerun the creation migration.

No automatic hard-delete API or retention job is provided in Phase 1. Request, history and audit FKs restrict deletion. Retention/anonymization requires a later approved policy and migration.
