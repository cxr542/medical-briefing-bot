import { sql } from './target.mjs';
import { LedgerError } from './manifest.mjs';

const foundation = ['support_requests','support_comments','support_status_history','support_internal_notes','support_audit_events'];
const attachments = ['support_request_upload_keys','support_attachments','support_attachment_parts','support_attachment_audit','support_attachment_objects'];
const baseFunctions = ['support.customer_rpc(text,jsonb)','support.admin_rpc(text,jsonb)',
  'public.customer_support_rpc(text,jsonb)','public.admin_support_rpc(text,jsonb)'];
const extraFunctions = ['public.support_attachment_create_rpc(jsonb,uuid)','support.attachment_rpc(text,text,jsonb)',
  'public.support_attachment_rpc(text,text,jsonb)','public.support_attachment_worker_rpc(text,jsonb)'];

export async function assertObjects(target, prefix) {
  const state = JSON.parse(await sql(target, `SELECT jsonb_build_object('schema',to_regnamespace('support') IS NOT NULL,
    'tables',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relforcerowsecurity,
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) ORDER BY c.relname),'[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='support' AND c.relkind='r'),
    'functions',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')',
      p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),
      has_function_privilege('service_role',p.oid,'EXECUTE'),position('ERRCODE=''40001''' in p.prosrc)>0,position('ERRCODE=''PT409''' in p.prosrc)>0)
      ORDER BY n.nspname,p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='support' OR (n.nspname='public' AND p.proname LIKE '%support%')));`));
  const tables = prefix === 0 ? [] : prefix === 1 ? foundation : [...foundation,...attachments];
  const functions = prefix === 0 ? [] : prefix === 1 ? baseFunctions : [...baseFunctions,...extraFunctions];
  if (state.schema !== (prefix > 0) || JSON.stringify(state.tables.map(row=>row[0]).sort()) !== JSON.stringify([...tables].sort())
    || JSON.stringify(state.functions.map(row=>row[0]).sort()) !== JSON.stringify([...functions].sort())
    || state.tables.some(row=>!row[1] || !row[2] || row[3] || row[4])
    || state.functions.some(row=>row[1] || JSON.stringify(row[2]) !== '["search_path=\\"\\""]' || row[3] || row[4] || !row[5])) {
    throw new LedgerError('OBJECT_LEDGER_MISMATCH');
  }
  const oldCodes = state.functions.filter(row=>row[6]).length;
  const newCodes = state.functions.filter(row=>row[7]).length;
  if (oldCodes !== [0,1,4,0][prefix] || newCodes !== (prefix === 3 ? 4 : 0)) throw new LedgerError('CONFLICT_DEFINITION_MISMATCH');
}
