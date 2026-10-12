import ast
import copy
from contextlib import redirect_stdout
from datetime import datetime, timezone
from html import escape
import io
from pathlib import Path
from types import SimpleNamespace
import unittest

import collector_parsers
from collector_parsers import parse_kdca_press_release_html
from collector_kdca_detail import article_id_from_call
from collector_detail_links import primary_article_payload, validated_source_detail_url
from test_source_detail_urls import RestStore, load_functions

ROOT=Path(__file__).resolve().parents[1]
NOW=datetime(2026,10,12,12,tzinfo=timezone.utc)
LIST='https://www.kdca.go.kr/bbs/kdca/42/artclList.do'
CALL="javascript:jf_viewArtcl('kdca','42','312868')"


def row(title='정상 공지', href=CALL, onclick=None, extra='', seq=1):
    attrs=' href="'+escape(href,quote=True)+'"'
    if onclick is not None: attrs+=' onclick="'+escape(onclick,quote=True)+'"'
    return f'<tr><td>{seq}</td><td><a{attrs}>{escape(title)}</a>{extra}</td><td>2026-10-12</td></tr>'


def parse(rows):
    return parse_kdca_press_release_html('<table><tbody>'+rows+'</tbody></table>',LIST,now=NOW)


def baseline(rows):
    p=ROOT/'tests/fixtures/kdca_parser_before_metadata.py'
    ns=dict(collector_parsers.__dict__)
    exec(compile(p.read_text(),str(p),'exec'),ns)
    return ns['parse_kdca_press_release_html']('<table><tbody>'+rows+'</tbody></table>',LIST,now=NOW)


class KdcaDetailParserTests(unittest.TestCase):
    def assert_parity(self, rows):
        actual=parse(rows); expected=baseline(rows)
        projected={**actual,'articles':[primary_article_payload(a) for a in actual['articles']]}
        self.assertEqual(projected,expected)
        return actual

    def test_documented_single_quote_href_keeps_search_identity_and_hash(self):
        article=self.assert_parity(row())['articles'][0]
        self.assertIn('artclList.do?page=1',article['url'])
        self.assertEqual(article['source_detail_url'],LIST.replace('artclList.do','312868/artclView.do'))
        self.assertEqual(validated_source_detail_url(article),article['source_detail_url'])

    def test_quoted_literal_variants_and_optional_whitespace_semicolon(self):
        for value in [CALL,CALL+';', ' \tjavascript: jf_viewArtcl( "kdca", "42", "312868" ); \n']:
            with self.subTest(value=value):
                self.assertEqual(self.assert_parity(row(href=value))['articles'][0]['source_detail_url'],
                                 'https://www.kdca.go.kr/bbs/kdca/42/312868/artclView.do')

    def test_onclick_variant_retains_preexisting_direct_identity(self):
        article=self.assert_parity(row(href='#',onclick="jf_viewArtcl('kdca','42','312868');"))['articles'][0]
        self.assertEqual(article['url'],article['source_detail_url'])

    def test_multiple_articles_bind_each_title_to_its_own_id(self):
        rows=''.join(row(title='공지 '+str(i),href=CALL.replace('312868',str(i)),seq=i) for i in [312868,312844,312845])
        articles=self.assert_parity(rows)['articles']
        self.assertEqual(len(articles),3)
        for article,i in zip(articles,[312868,312844,312845]):
            self.assertEqual(article['title'],'공지 '+str(i))
            self.assertIn(f'/{i}/',article['source_detail_url'])

    def test_offline_regression_fixture_preserves_three_verified_pairs(self):
        html=(ROOT/'tests/fixtures/kdca-jf-view-artcl.html').read_text()
        result=parse_kdca_press_release_html(html,LIST,now=NOW)
        self.assertEqual([a['source_detail_url'].split('/')[-2] for a in result['articles']],['312868','312844','312845'])

    def test_invalid_calls_never_drop_article_or_change_identity_hash_counts(self):
        invalid=[CALL.replace("'kdca'","'other'"),CALL.replace("'42'","'43'"),
                 CALL.replace("'312868'","''"),CALL.replace("'312868'","'abc'"),
                 CALL.replace("'312868'","'-1'"),CALL.replace("'312868'","'0'"),
                 CALL.replace("'312868'","'0312868'"),CALL.replace("'312868'","'1.2'"),
                 CALL.replace("'312868'","'１２３'"),CALL.replace("'312868'","' 312868'"),
                 CALL.replace("'312868'","'../312868'"),CALL.replace("'312868'","'312868/a'"),
                 CALL.replace("'312868'","'312868?x=1'"),CALL.replace("'312868'","'312868#x'"),
                 CALL.replace("'312868'","312868"),CALL.replace("'312868'","1+2"),
                 CALL.replace("'312868'","'1234567890123456789'"),CALL.replace("'312868'","'312868', 'extra'"),
                 CALL[:-1],CALL+';alert(1)',CALL.replace("'312868'",'"312868\''),
                 'javascript:unrelated(312868)', 'javascript:/*comment*/jf_viewArtcl(\'kdca\',\'42\',\'312868\')',
                 'https://evil.test/'+CALL,'#','']
        for value in invalid:
            with self.subTest(value=value):
                articles=self.assert_parity(row(href=value))['articles']
                self.assertEqual(len(articles),1)
                self.assertNotIn('source_detail_url',articles[0])

    def test_neighboring_article_id_does_not_leak_into_title_without_call(self):
        rows=row(title='ID 없는 공지',href='#')+row(title='다음 공지')
        articles=self.assert_parity(rows)['articles']
        self.assertNotIn('source_detail_url',articles[0])
        self.assertIn('/312868/',articles[1]['source_detail_url'])

    def test_other_anchor_and_nested_row_calls_cannot_be_borrowed(self):
        extra='<a href="'+escape(CALL,quote=True)+'">첨부파일</a>'
        self.assertNotIn('source_detail_url',self.assert_parity(row(href='#',extra=extra))['articles'][0])
        nested='<table><tr><td><a href="'+escape(CALL,quote=True)+'">이웃</a></td><td>2026-10-12</td></tr></table>'
        articles=self.assert_parity('<tr><td>1</td><td>'+nested+'</td><td>2026-10-12</td></tr>')['articles']
        self.assertNotIn('source_detail_url',articles[0])

    def test_duplicate_titles_with_same_or_different_ids_suppress_only_metadata(self):
        for second in [CALL,CALL.replace('312868','312844'),'#']:
            articles=self.assert_parity(row()+row(href=second,seq=2))['articles']
            self.assertEqual(len(articles),2)
            self.assertTrue(all('source_detail_url' not in a for a in articles))

    def test_one_id_claimed_by_different_titles_is_ambiguous(self):
        articles=self.assert_parity(row(title='A')+row(title='B',seq=2))['articles']
        self.assertTrue(all('source_detail_url' not in a for a in articles))

    def test_conflicting_href_onclick_or_unrelated_handler_suppresses_metadata(self):
        for onclick in ["jf_viewArtcl('kdca','42','312844')",'alert(1)',"jf_viewArtcl('kdca','42','312868');alert(1)"]:
            self.assertNotIn('source_detail_url',self.assert_parity(row(onclick=onclick))['articles'][0])

    def test_external_href_with_valid_onclick_is_not_trusted(self):
        a=self.assert_parity(row(href='https://evil.test/a',onclick="jf_viewArtcl('kdca','42','312868')"))['articles'][0]
        self.assertNotIn('source_detail_url',a)

    def test_entity_and_whitespace_title_normalization_stays_baseline_identical(self):
        a=self.assert_parity(row(title='  A & B  새글'))['articles'][0]
        self.assertEqual(a['title'],'A & B')
        self.assertIn('/312868/',a['source_detail_url'])

    def test_invalid_institution_list_context_cannot_create_metadata(self):
        for list_url in ['https://evil.test/list','http://www.kdca.go.kr/bbs/kdca/42/artclList.do',LIST+'?extra=1']:
            a=parse_kdca_press_release_html('<table>'+row()+'</table>',list_url,now=NOW)['articles'][0]
            self.assertNotIn('source_detail_url',a)

    def test_valid_invalid_missing_metadata_all_have_same_original_hash(self):
        articles=[parse(row(href=h))['articles'][0] for h in [CALL,CALL.replace('312868','abc'),'#']]
        self.assertEqual(len({a['url'] for a in articles}),1)
        self.assertEqual(len({a['content_hash'] for a in articles}),1)

    def test_real_storage_path_inserts_then_metadata_fills_without_primary_metadata(self):
        article=parse(row())['articles'][0]
        store=RestStore();self.addCleanup(store.client.aclose)
        with redirect_stdout(io.StringIO()):stats=load_functions(store.client)['sync_articles']([copy.deepcopy(article)])
        self.assertEqual(stats,dict(attempted=1,succeeded=1,failed=0))
        self.assertEqual(store.rows[0]['url'],article['url'])
        self.assertEqual(store.rows[0]['source_detail_url'],article['source_detail_url'])
        self.assertNotIn('source_detail_url',next(r[2] for r in store.requests if r[0]=='POST'))

    def test_natural_reobservation_null_fills_without_lifecycle_update(self):
        article=parse(row())['articles'][0]
        old={**primary_article_payload(article),'id':42,'source_detail_url':None}
        store=RestStore([old]);self.addCleanup(store.client.aclose)
        with redirect_stdout(io.StringIO()):stats=load_functions(store.client)['sync_articles']([copy.deepcopy(article)])
        self.assertEqual(stats,dict(attempted=0,succeeded=0,failed=0))
        self.assertEqual([r[0] for r in store.requests],['GET','PATCH'])
        self.assertEqual(store.rows[0]['source_detail_url'],article['source_detail_url'])

    def test_failed_extraction_preserves_stored_detail_and_deleted_contract(self):
        valid=parse(row())['articles'][0]; failed=parse(row(href='#'))['articles'][0]
        for status in ['NEW','DELETED']:
            old={**valid,'id':42,'status':status}
            store=RestStore([old]);self.addCleanup(store.client.aclose)
            with redirect_stdout(io.StringIO()):stats=load_functions(store.client)['sync_articles']([copy.deepcopy(failed)])
            self.assertEqual(stats,dict(attempted=0,succeeded=0,failed=0))
            self.assertEqual(store.rows,[old])

    def test_real_collector_fallback_function_passes_optional_candidates_and_keeps_counts(self):
        tree=ast.parse((ROOT/'collector.py').read_text())
        function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='fetch_kdca_press_releases')
        def rss(*args):raise ValueError('offline RSS failure')
        for href in [CALL,'#',CALL.replace('312868','abc')]:
            diagnostics={}
            response=SimpleNamespace(text='<table>'+row(href=href)+'</table>',raise_for_status=lambda:None)
            ns=dict(fetch_rss_feed=rss,get_with_transient_retry=lambda *args,**kwargs:response,
                    parse_kdca_press_release_html=lambda html,url:parse_kdca_press_release_html(html,url,now=NOW),
                    source_collection_diagnostics=diagnostics)
            exec(compile(ast.Module(body=[function],type_ignores=[]),'collector-fallback-offline','exec'),ns)
            with redirect_stdout(io.StringIO()):articles=ns['fetch_kdca_press_releases']()
            self.assertEqual(len(articles),1)
            self.assertIn('valid_recent=1',diagnostics['질병관리청 보도자료'])
            self.assertEqual('source_detail_url' in articles[0],href==CALL)

    def test_no_eval_and_full_call_grammar(self):
        tree=ast.parse((ROOT/'collector_kdca_detail.py').read_text())
        self.assertFalse(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id in {'eval','exec'} for n in ast.walk(tree)))
        self.assertIsNone(article_id_from_call('jf_viewArtcl(\'kdca\',\'42\',\'312868\'); other()'))


if __name__=='__main__':unittest.main()
