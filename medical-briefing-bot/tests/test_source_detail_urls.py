"""Real storage functions and PostgREST SDK; all HTTP stays in MockTransport."""
import ast
import copy
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
import io
import itertools
import json
from pathlib import Path
import unittest
from urllib.parse import quote

import httpx
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError
from collector_detail_links import (DETAIL_FIELD, GUARD_FIELDS, primary_article_payload,
                                   safe_https_url, save_source_detail_urls, validated_source_detail_url)
from collector_lifecycle import find_absent_article_urls
from collector_parsers import get_content_hash

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / 'tests/fixtures/source-detail-links.json').read_text())
DETAIL = FIXTURE['detail']
OTHER = DETAIL.replace('312999', '312998')


def record(detail=None, status='NEW'):
    title = '오프라인 계약 공지'
    return dict(id=42, source='질병관리청 보도자료', title=title,
                url='https://www.kdca.go.kr/bbs/kdca/42/artclList.do?page=1&srchColumn=title&srchWrd='+quote(title),
                published_date='2026-10-12T00:00:00+00:00', content_hash=get_content_hash(title),
                status=status, source_detail_url=detail)


class RestStore:
    def __init__(self, rows=(), column=True, error=None, race=None, primary_error=False):
        self.rows = copy.deepcopy(list(rows))
        self.column, self.error, self.race = column, error, race
        self.primary_error = primary_error
        if not column:
            for row in self.rows:
                row.pop(DETAIL_FIELD, None)
        self.requests = []
        self.client = SyncPostgrestClient('https://offline.invalid/rest/v1',
            http_client=httpx.Client(transport=httpx.MockTransport(self.handle)))

    def handle(self, request):
        payload = json.loads(request.content) if request.content else None
        self.requests.append((request.method, dict(request.url.params), payload))
        if request.method == 'GET':
            return httpx.Response(200, json=copy.deepcopy(self.rows))
        if request.method == 'POST':
            assert request.url.params['on_conflict'] == 'url'
            assert DETAIL_FIELD not in payload
            if self.primary_error:
                return httpx.Response(403, json=dict(code='42501', message='primary unavailable', details=None, hint=None))
            old = next((r for r in self.rows if r['url'] == payload['url']), None)
            if old is None:
                old = {'id': 43, **({DETAIL_FIELD: None} if self.column else {})}
                self.rows.append(old)
            old.update(payload)
            return httpx.Response(200, json=[copy.deepcopy(old)])
        assert request.method == 'PATCH'
        assert set(payload) == {DETAIL_FIELD}
        if self.error:
            if isinstance(self.error, Exception):
                raise self.error
            return httpx.Response(403, json=dict(code=self.error, message='secret-token-do-not-log', details=None, hint=None))
        if not self.column:
            return httpx.Response(400, json=dict(code='PGRST204', message='Could not find source_detail_url in schema cache', details=None, hint=None))
        if self.race:
            self.race(self.rows)
            self.race = None
        matched = []
        for row in self.rows:
            matches = all(row.get(k) is None if v == 'is.null' else
                          str(row.get(k)) == v.removeprefix('eq.') for k,v in request.url.params.items())
            if matches:
                row.update(payload)
                matched.append(copy.deepcopy(row))
        return httpx.Response(200, json=matched)

    def metadata_requests(self):
        return [r for r in self.requests if r[0] == 'PATCH']


class QuietBoundary:
    def close(self):
        pass


def load_functions(client, baseline=False):
    path = ROOT / ('tests/fixtures/collector_lifecycle_before_detail.py' if baseline else 'collector.py')
    names = {'track_states'} if baseline else {'track_states', 'save_keyword_boundary', 'save_to_supabase', 'sync_articles'}
    tree = ast.parse(path.read_text())
    functions = [n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
    ns = dict(Client=object, datetime=datetime, timezone=timezone, timedelta=timedelta,
              supabase=client, find_absent_article_urls=find_absent_article_urls,
              primary_article_payload=primary_article_payload, save_source_detail_urls=save_source_detail_urls,
              KeywordBoundaryClient=QuietBoundary, enrich_saved_article=lambda *args: None,
              SavedArticle=dict, Metadata=dict, APIError=APIError, HTTPError=httpx.HTTPError)
    exec(compile(ast.Module(body=functions,type_ignores=[]),str(path),'exec'),ns)
    return ns


class DetailContractTests(unittest.TestCase):
    def store(self, *args, **kwargs):
        store = RestStore(*args, **kwargs)
        self.addCleanup(store.client.aclose)
        return store

    def metadata(self, store, candidates, snapshots=None):
        with redirect_stdout(io.StringIO()):
            return save_source_detail_urls(store.client,candidates,
                                           copy.deepcopy(store.rows) if snapshots is None else snapshots)

    def sync(self, store, candidates, incomplete=None):
        with redirect_stdout(io.StringIO()):
            return load_functions(store.client)['sync_articles'](copy.deepcopy(candidates),incomplete)

    def test_case1_null_fill_does_not_require_primary_change(self):
        old = record()
        store = self.store([old])
        self.assertEqual(self.sync(store,[record(DETAIL)]),dict(attempted=0,succeeded=0,failed=0))
        self.assertEqual(store.rows,[{**old,DETAIL_FIELD:DETAIL}])
        self.assertEqual([r[0] for r in store.requests],['GET','PATCH'])

    def test_case2_same_value_noop(self):
        store = self.store([record(DETAIL)])
        self.assertEqual(self.metadata(store,[record(DETAIL)])['unchanged'],1)
        self.assertEqual(store.metadata_requests(),[])

    def test_case3_conflicting_value_preserved_and_diagnosed(self):
        store = self.store([record(DETAIL)])
        self.assertEqual(self.metadata(store,[record(OTHER)])['conflict'],1)
        self.assertEqual(store.rows,[record(DETAIL)])
        self.assertEqual(store.metadata_requests(),[])

    def test_case4_null_or_missing_candidate_preserves_existing(self):
        for candidate in [record(),primary_article_payload(record())]:
            store = self.store([record(DETAIL)])
            self.sync(store,[candidate])
            self.assertEqual(store.rows,[record(DETAIL)])
            self.assertEqual(store.metadata_requests(),[])

    def test_case5_deleted_rows_never_receive_metadata_even_when_baseline_recovers(self):
        for changed in [False,True]:
            old=record(None,'DELETED')
            incoming=record(DETAIL)
            if changed: incoming['content_hash']='changed-content'
            store=self.store([old])
            self.sync(store,[incoming])
            self.assertIsNone(store.rows[0][DETAIL_FIELD])
            self.assertEqual(store.rows[0]['status'],'UPDATE' if changed else 'DELETED')
            self.assertEqual(store.metadata_requests(),[])

    def test_case6_unknown_identity_metadata_alone_never_inserts(self):
        store=self.store()
        self.assertEqual(self.metadata(store,[record(DETAIL)])['skipped'],1)
        self.assertEqual(store.rows,[])
        self.assertEqual(store.requests,[])

    def test_normal_new_article_is_upserted_then_enriched_without_changing_identity(self):
        store=self.store()
        incoming=record(DETAIL)
        incoming.pop('id'); incoming.pop('status')
        result=self.sync(store,[incoming])
        self.assertEqual(result,dict(attempted=1,succeeded=1,failed=0))
        self.assertEqual([r[0] for r in store.requests],['GET','POST','PATCH'])
        self.assertEqual(store.rows[0]['url'],incoming['url'])
        self.assertEqual(store.rows[0][DETAIL_FIELD],DETAIL)
        self.assertEqual(store.rows[0]['id'],43)
        self.assertEqual(store.rows[0]['status'],'NEW')

    def test_repeated_run_is_idempotent_and_no_second_primary_save(self):
        store=self.store([record()])
        self.sync(store,[record(DETAIL)])
        before=copy.deepcopy(store.rows)
        self.sync(store,[record(DETAIL)])
        self.assertEqual(store.rows,before)
        self.assertEqual(len(store.metadata_requests()),1)

    def test_duplicate_candidates_keep_one_row_and_one_metadata_patch(self):
        store=self.store()
        result=self.sync(store,[record(DETAIL),record(DETAIL)])
        self.assertEqual(result['attempted'],2)  # Existing duplicate upsert contract.
        self.assertEqual(len(store.rows),1)
        self.assertEqual(len(store.metadata_requests()),1)

    def test_conflicting_candidates_for_one_identity_are_not_guessed(self):
        store=self.store([record()])
        self.assertEqual(self.metadata(store,[record(DETAIL),record(OTHER)])['conflict'],1)
        self.assertEqual(store.metadata_requests(),[])

    def test_patch_guards_revision_fields_and_only_sets_metadata(self):
        store=self.store([record()])
        self.metadata(store,[record(DETAIL)])
        method,params,payload=store.metadata_requests()[0]
        self.assertEqual(payload,{DETAIL_FIELD:DETAIL})
        self.assertEqual(set(params),set(GUARD_FIELDS)|{DETAIL_FIELD})
        self.assertEqual(params[DETAIL_FIELD],'is.null')
        self.assertEqual(params['url'],'eq.'+record()['url'])
        self.assertEqual(params['status'],'eq.NEW')

    def test_concurrent_revision_change_causes_safe_cas_miss(self):
        for field in GUARD_FIELDS:
            with self.subTest(field=field):
                store=self.store([record()],race=lambda rows,k=field: rows[0].update({k:'concurrent'}))
                self.assertEqual(self.metadata(store,[record(DETAIL)])['skipped'],1)
                self.assertIsNone(store.rows[0][DETAIL_FIELD])

    def test_concurrent_metadata_fill_is_never_overwritten(self):
        store=self.store([record()],race=lambda rows:rows[0].update({DETAIL_FIELD:OTHER}))
        self.assertEqual(self.metadata(store,[record(DETAIL)])['skipped'],1)
        self.assertEqual(store.rows[0][DETAIL_FIELD],OTHER)

    def test_snapshot_mismatch_and_invalid_identity_id_are_skipped(self):
        for field,value in [('source','wrong'),('title','wrong'),('content_hash','wrong'),
                            ('published_date','2026-10-11T00:00:00+00:00'),('id',None),('id',True),('id',0)]:
            store=self.store([{**record(),field:value}])
            self.assertEqual(self.metadata(store,[record(DETAIL)])['skipped'],1)
            self.assertEqual(store.metadata_requests(),[])

    def test_equivalent_timezone_dates_pass_but_naive_date_does_not(self):
        store=self.store([record()])
        self.assertEqual(self.metadata(store,[{**record(DETAIL),'published_date':'2026-10-12T09:00:00+09:00'}])['updated'],1)
        store=self.store([record()])
        self.assertEqual(self.metadata(store,[{**record(DETAIL),'published_date':'2026-10-12T00:00:00'}])['skipped'],1)

    def test_missing_schema_leaves_primary_insert_successful_and_frontend_compatible(self):
        store=self.store(column=False)
        result=self.sync(store,[record(DETAIL)])
        self.assertEqual(result,dict(attempted=1,succeeded=1,failed=0))
        self.assertNotIn(DETAIL_FIELD,store.rows[0])
        self.assertEqual(len(store.rows),1)

    def test_missing_schema_stops_remaining_optional_attempts(self):
        first=record(DETAIL)
        second={**first,'url':OTHER,DETAIL_FIELD:OTHER,'id':43}
        store=self.store([primary_article_payload(first),primary_article_payload(second)],column=False)
        stats=self.metadata(store,[first,second])
        self.assertEqual(stats['unavailable'],2)
        self.assertEqual(len(store.metadata_requests()),1)

    def test_optional_permission_and_transport_failures_do_not_change_primary_counts(self):
        for error in ['42501',httpx.ReadTimeout('secret-token-do-not-log')]:
            store=self.store(error=error)
            self.assertEqual(self.sync(store,[record(DETAIL)]),dict(attempted=1,succeeded=1,failed=0))
            self.assertIsNone(store.rows[0][DETAIL_FIELD])

    def test_primary_failure_blocks_optional_write(self):
        store=self.store([record()],primary_error=True)
        changed={**record(DETAIL),'content_hash':'changed'}
        self.assertEqual(self.sync(store,[changed]),dict(attempted=1,succeeded=0,failed=1))
        self.assertEqual(store.metadata_requests(),[])

    def test_existing_field_is_preserved_through_deletion_and_content_upserts(self):
        store=self.store([record(DETAIL)])
        other={**record(),'url':OTHER,'title':'다른 기사'}
        self.sync(store,[other])
        self.assertEqual(store.rows[0]['status'],'DELETED')
        self.assertEqual(store.rows[0][DETAIL_FIELD],DETAIL)
        self.assertTrue(all(DETAIL_FIELD not in r[2] for r in store.requests if r[0]=='POST'))

    def test_absent_field_uses_no_optional_queries_or_logging(self):
        store=self.store([record()],column=False)
        incoming=primary_article_payload(record())
        output=io.StringIO()
        with redirect_stdout(output):
            load_functions(store.client)['sync_articles']([incoming])
        self.assertNotIn('Source detail metadata',output.getvalue())
        self.assertEqual([r[0] for r in store.requests],['GET'])

    def test_conflict_and_errors_only_log_aggregate_counts(self):
        store=self.store([record()],error='42501')
        output=io.StringIO()
        with redirect_stdout(output):
            stats=save_source_detail_urls(store.client,[record(DETAIL)],store.rows)
        self.assertEqual(stats['failed'],1)
        self.assertIn('failed=1',output.getvalue())
        for secret in ['secret-token','https://','Authorization','SUPABASE']:
            self.assertNotIn(secret,output.getvalue())

    def test_shared_url_fixture_and_source_identity_binding(self):
        for detail in FIXTURE['valid']:
            self.assertEqual(validated_source_detail_url(record(detail)),detail)
        for detail in FIXTURE['invalid']:
            self.assertIsNone(validated_source_detail_url(record(detail)),repr(detail))
        for change in [dict(source='Unknown'),dict(url='https://evil.test/a'),
                       dict(url=record()['url']+'#'),dict(title='different')]:
            self.assertIsNone(validated_source_detail_url({**record(DETAIL),**change}))
        self.assertEqual(validated_source_detail_url({**record(DETAIL),'url':DETAIL}),DETAIL)

    def test_generic_validation_rejects_unsafe_urls_without_source_upgrade(self):
        self.assertEqual(safe_https_url('https://example.org/article'),'https://example.org/article')
        for value in ['https:///a','https://localhost/a','https://-bad.org/a','https://user@host.org/a',
                      'https://host.org:443/a','https://host.org/a\n','https://host.org\\a']:
            self.assertIsNone(safe_https_url(value))
        self.assertIsNone(validated_source_detail_url({**record(DETAIL),'source':'Unknown'}))

    def test_primary_payload_is_nonmutating_and_content_hash_excludes_metadata(self):
        hashes=[]
        for detail in [None,DETAIL,OTHER]:
            article=record(detail); before=copy.deepcopy(article)
            payload=primary_article_payload(article)
            self.assertEqual(article,before)
            self.assertNotIn(DETAIL_FIELD,payload)
            hashes.append(payload['content_hash'])
        self.assertEqual(len(set(hashes)),1)
        tree=ast.parse((ROOT/'collector.py').read_text())
        calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='get_content_hash']
        self.assertGreater(len(calls),0)
        self.assertTrue(all(DETAIL_FIELD not in ast.unparse(n) for n in calls))

    def test_108_lifecycle_combinations_match_frozen_main_actual_functions(self):
        count=0
        for status,old_detail,new_detail,changed,partial in itertools.product(
                ['NEW','UPDATE','DELETED'],[None,DETAIL,OTHER],[None,DETAIL,OTHER],[False,True],[False,True]):
            old=record(old_detail,status); incoming=record(new_detail)
            if changed: old['content_hash']='old-content'
            incomplete={old['source']} if partial else set()
            baseline_store=self.store([primary_article_payload(old)])
            actual_store=self.store([old])
            with redirect_stdout(io.StringIO()):
                baseline=load_functions(baseline_store.client,True)['track_states'](
                    [primary_article_payload(incoming)],baseline_store.client,incomplete)
            self.sync(actual_store,[incoming],incomplete)
            primary=[r[2] for r in actual_store.requests if r[0]=='POST']
            self.assertEqual(primary,baseline,(status,old_detail,new_detail,changed,partial))
            if status=='DELETED': self.assertEqual(actual_store.metadata_requests(),[])
            self.assertEqual(actual_store.rows[0]['url'],old['url'])
            count+=1
        self.assertEqual(count,108)

    def test_empty_failed_partial_and_successful_source_deletion_parity(self):
        old=record(DETAIL)
        other={**record(OTHER),'url':OTHER}
        for incoming,incomplete in [([],set()),([other],{old['source']}),([other],set())]:
            base=self.store([primary_article_payload(old)])
            actual=self.store([old])
            with redirect_stdout(io.StringIO()):
                expected=load_functions(base.client,True)['track_states'](
                    [primary_article_payload(r) for r in incoming],base.client,incomplete)
            self.sync(actual,incoming,incomplete)
            self.assertEqual([r[2] for r in actual.requests if r[0]=='POST'],expected)

    def test_migration_is_additive_nullable_and_contains_no_dml_or_policy_changes(self):
        files=list((ROOT.parent/'supabase/migrations').glob('*_article_source_detail_url.sql'))
        self.assertEqual(len(files),1)
        sql=' '.join(line for line in files[0].read_text().splitlines() if not line.lstrip().startswith('--'))
        self.assertEqual(' '.join(sql.split()),'ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS source_detail_url text;')
        for forbidden in ['NOT NULL','DEFAULT','UNIQUE','CREATE INDEX','UPDATE ','DELETE ','INSERT ','DROP ','POLICY']:
            self.assertNotIn(forbidden,sql.upper())


if __name__=='__main__':
    unittest.main()
