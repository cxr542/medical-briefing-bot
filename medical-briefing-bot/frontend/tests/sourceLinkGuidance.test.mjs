import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { copyArticleTitle, institutionGuidance } from '../src/lib/sourceLinkGuidance.ts';

const sources = [
 ['심평원 e-평가 (평가알림방)', 'https://aq.hira.or.kr/hira_aq/index.jsp#brdSno=2279'],
 ['심평원 업무포탈 (자보알림방)', 'http://biz.hira.or.kr/indexS.ndo?PROGRAM_ID=MP00000616&PROGRAM_PARAM=nttId==75941'],
 ['산재업무포탈', 'https://total.comwel.or.kr/#ser=2145'],
 ['보건의료자원포탈', 'https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok#no=758'],
];
const filename = new URL('../src/components/SourceLink.tsx', import.meta.url);
const require = createRequire(filename);
const compiled = ts.transpileModule(readFileSync(filename,'utf8'), {
 compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText;
function harness(clipboard) {
 let state='idle',opened=false,closed=false;
 const exports={};
 const fakeReact={useId:()=> 'test-id',useState:()=>[state,value=>{state=value;}],
  useRef:()=>({current:{showModal:()=>{opened=true;},close:()=>{closed=true;}}})};
 runInNewContext(compiled,{exports,navigator:{clipboard},require:name=>name==='react'?fakeReact:require(name.startsWith('../lib/')?`${name}.ts`:name)});
 const render=article=>exports.SourceLink({article});
 return {render,get state(){return state;},get opened(){return opened;},get closed(){return closed;}};
}
function nodes(tree){
 if(!tree || typeof tree!=='object') return [];
 return [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function find(tree,predicate){return nodes(tree).find(predicate);}
const article={source:sources[0][0],url:sources[0][1],title:'긴 제목 & 정확한 <원문> 제목'};

test('only confirmed sources use the structural constraint message',()=>{
 for(const [source] of sources) assert.match(institutionGuidance(source),/기관 사이트 특성상/);
 assert.match(institutionGuidance('질병관리청 보도자료'),/직접 상세 링크가 확인되지 않았습니다/);
});
test('copy helper sends the exact original title',async()=>{
 const calls=[];
 assert.equal(await copyArticleTitle(article.title,{writeText:async title=>{calls.push(title);}}),true);
 assert.deepEqual(calls,[article.title]);
});
test('missing clipboard yields manual-copy outcome without throwing',async()=>{
 assert.equal(await copyArticleTitle(article.title),false);
});
test('clipboard rejection and synchronous exception are contained',async()=>{
 for(const writeText of [async()=>{throw Error('denied');},()=>{throw Error('unavailable');}])
  assert.equal(await copyArticleTitle(article.title,{writeText}),false);
});
test('real copy action keeps dialog open and announces success',async()=>{
 const calls=[],h=harness({writeText:async title=>{calls.push(title);}});
 let tree=h.render(article);
 find(tree,n=>n.type==='button' && n.props['aria-haspopup']==='dialog').props.onClick();
 assert.equal(h.opened,true);
 await find(tree,n=>n.type==='button' && n.props.onClick?.constructor.name==='AsyncFunction').props.onClick();
 assert.deepEqual(calls,[article.title]);assert.equal(h.closed,false);assert.equal(h.state,'copied');
 tree=h.render(article);
 const status=find(tree,n=>n.props?.role==='status');
 assert.equal(status.props['aria-live'],'polite');assert.equal(status.props.children,'제목을 복사했습니다.');
});
test('real unavailable and denied actions show manual guidance without closing',async()=>{
 for(const clipboard of [undefined,{writeText:async()=>{throw Error('denied');}}]){
  const h=harness(clipboard),tree=h.render(article);
  await find(tree,n=>n.type==='button' && n.props.onClick?.constructor.name==='AsyncFunction').props.onClick();
  assert.equal(h.closed,false);assert.equal(h.state,'error');
  assert.match(find(h.render(article),n=>n.props?.role==='status').props.children,/직접 선택해 복사/);
 }
});
test('real close action and native close reset feedback',async()=>{
 const h=harness({writeText:async()=>{}}),tree=h.render(article);
 await find(tree,n=>n.type==='button' && n.props.onClick?.constructor.name==='AsyncFunction').props.onClick();
 find(tree,n=>n.type==='button' && n.props['aria-label']==='기관 안내 닫기').props.onClick();assert.equal(h.closed,true);
 find(tree,n=>n.type==='dialog').props.onClose();assert.equal(h.state,'idle');
 assert.equal(find(tree,n=>n.type==='dialog').props.onCancel,undefined); // Keep native Escape behavior.
});
test('four fallback sources retain the correct institution CTA and labelled dialog',()=>{
 const hrefs=['https://aq.hira.or.kr/hira_aq/index.jsp','https://biz.hira.or.kr/index.do','https://total.comwel.or.kr/','https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok'];
 for(const [i,[source,url]] of sources.entries()){
  const tree=harness().render({source,url,title:article.title});
  const dialog=find(tree,n=>n.type==='dialog');assert.ok(dialog.props['aria-labelledby']);assert.ok(dialog.props['aria-describedby']);
  const cta=find(tree,n=>n.type==='a');assert.equal(cta.props.href,hrefs[i]);assert.equal(cta.props.target,'_blank');assert.equal(cta.props.rel,'noopener noreferrer');
 }
});
test('direct source remains an anchor without copy or dialog',()=>{
 const tree=harness().render({source:'식품의약품안전처 보도자료',title:'공지',url:'https://www.mfds.go.kr/brd/m_99/view.do?seq=50403'});
 assert.equal(tree.type,'a');assert.equal(find(tree,n=>n.type==='dialog'),undefined);
});
