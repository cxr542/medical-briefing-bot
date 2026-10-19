export const MIGRATIONS = Object.freeze([
  { version: '20261016014502', name: 'support_foundation', sha256: 'f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6' },
  { version: '20261016035115', name: 'support_attachments', sha256: '6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b' },
  { version: '20261019041429', name: 'support_conflict_sqlstate', sha256: '610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1' },
].map(Object.freeze));
export const LEGACY = Object.freeze([
  ['20260928064906', 'collector_alert_state'],
  ['20260929063328', '20260928010000_collector_runs_admin_only'],
  ['20261007041102', 'article_keyword_boundary'],
  ['20261012043225', 'article_source_detail_url'],
].map(Object.freeze));
export const DATABASE = 'medical_mb006_ledger';
export const IMAGE = 'postgres:17.6-alpine';
export const LOCK = 6006004;
export const filename = item => `${item.version}_${item.name}.sql`;
export const key = item => `mb006:${item.version}:sha256:${item.sha256}`;
export const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export class LedgerError extends Error {
  constructor(code) { super(code); this.name = 'LedgerError'; this.code = code; }
}
