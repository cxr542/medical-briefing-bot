import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { NOTE_PATH, appendNote, validateNotes, validateAddition, parseReleaseDecision } from '../scripts/release-note-contract.mjs';
import { generateNotePR, reconcile, validateNotePullRequest, noteBody } from '../scripts/release-note-automation.mjs';

const repository = 'cxr542/medical-briefing-bot';
const existing = JSON.parse(readFileSync(new URL('../frontend/src/data/generatedReleaseNotes.json', import.meta.url), 'utf8'));
const source = () => ({ number: 999, merged_at: '2026-10-15T00:10:00Z', html_url: `https://github.com/${repository}/pull/999`, base: { ref: 'main', repo: { full_name: repository } }, head: { ref: 'feat/change' }, body: '## Release Note\nCategory: 개선\nTitle: Safe note\n- Change\n', labels: [{ name: 'release-note' }] });
const clone = value => structuredClone(value);
function fixture() {
  const pr = source(), state = { main: 'base', branch: null, notes: null, open: [], closed: [], writes: [], source: pr, files: [{ filename: NOTE_PATH, status: 'modified' }], failPR: false, parent: 'base', paginated: [pr] };
  const api = {
    repos: {
      getContent: async ({ ref, path }) => { assert.equal(path, NOTE_PATH); return { data: { encoding: 'base64', content: Buffer.from(JSON.stringify(ref === 'base' ? existing : state.notes)).toString('base64') } }; },
      compareCommitsWithBasehead: async () => ({ data: { files: state.files } }),
    },
    git: {
      getRef: async ({ ref }) => { if(ref === 'heads/main') return { data: { object: { sha: state.main } } }; if(!state.branch) throw Object.assign(new Error(),{status:404}); return { data: { object: { sha: state.branch } } }; },
      getCommit: async ({ commit_sha }) => ({ data: commit_sha === 'base' ? { tree: { sha: 'tree' } } : { parents: [{ sha: state.parent }] } }),
      createTree: async args => { state.writes.push('tree'); assert.equal(args.tree.length,1);assert.equal(args.tree[0].path,NOTE_PATH);state.notes=JSON.parse(args.tree[0].content);return { data: {sha:'new-tree'} }; },
      createCommit: async args => { state.writes.push('commit'); assert.deepEqual(args.parents,['base']);return { data: {sha:'note-head'} }; },
      createRef: async args => { assert.equal(args.ref,'refs/heads/automation/release-note/pr-999');state.writes.push('branch');state.branch=args.sha;return {data:{}}; },
    },
    pulls: {
      get: async ({pull_number}) => ({data:pull_number===999?state.source:state.notePR}),
      list: async ({state:status}) => ({data:status==='open'?state.open:state.closed}),
      create: async args => {state.writes.push('pr');assert.equal(args.base,'main');assert.equal(args.head,'automation/release-note/pr-999');assert.equal('labels' in args,false);if(state.failPR)throw Object.assign(new Error('opaque'),{status:500});const p={number:1000,body:args.body,labels:[]};state.open=[p];return {data:p};},
      listFiles: async () => ({data:state.files}),
    },
  };
  const github={rest:api,paginate:async method=>method===api.pulls.list?state.paginated:state.files};
  return {state,github,run:dryRun=>generateNotePR({github,repository,number:999,dryRun})};
}

test('shared parser removes commented contracts and rejects unsupported/duplicate fields',()=>{
 assert.equal(parseReleaseDecision('<!-- ## Release Note\nCategory: X -->\n## No Release Note\nReason: internal',[]).kind,'excluded');
 for(const body of ['## Release Note\nCategory: UI\nTitle: x','## Release Note\nCategory: 개선\nCategory: 운영\nTitle: x','## Release Note\nCategory:\nTitle: x'])assert.throws(()=>parseReleaseDecision(body,['release-note']));
});
test('legacy data and PR84/85 manual details survive append byte-equivalent as objects',()=>{
 const before=JSON.stringify(existing),result=appendNote(existing,source(),repository);
 assert.equal(result.added,true);assert.deepEqual(result.notes.slice(1),existing);assert.equal(JSON.stringify(existing),before);
 assert.equal(result.notes.find(x=>x.id==='2026-10-13-pr-84').summary,existing.find(x=>x.id==='2026-10-13-pr-84').summary);
 assert.equal(validateAddition(existing,result.notes,source(),repository),true);
});
test('same source ID is no-op even if source metadata was subsequently edited',()=>{
 const result=appendNote(existing,source(),repository);const pr=source();pr.body='invalid edited body';
 assert.equal(appendNote(result.notes,pr,repository).added,false);
});
test('schema rejects duplicate IDs, bad arrays, dates and links',()=>{
 assert.throws(()=>validateNotes([existing[0],existing[0]]));
 for(const patch of [{changes:'bad'},{date:'bad'},{links:[{label:'x'}]}])assert.throws(()=>validateNotes([{...existing[0],...patch}]));
});
test('preservation/source checks reject deletions, overwrites, wrong source link/date and extra items',()=>{
 const notes=appendNote(existing,source(),repository).notes;
 for(const change of [a=>a.pop(),a=>a[1].title='overwritten',a=>a[0].links[0].url='https://evil.invalid',a=>a[0].date='2026.10.14',a=>a.push({...a[0],id:'another'})]){const candidate=clone(notes);change(candidate);assert.throws(()=>validateAddition(existing,candidate,source(),repository));}
});
test('generated PR passes shared guard without release-note label',()=>{
 assert.equal(parseReleaseDecision(noteBody(source()),[]).kind,'excluded');
});
test('generator dry run performs no writes',async()=>{const f=fixture();assert.equal((await f.run(true)).status,'would-create-pr');assert.deepEqual(f.state.writes,[]);});
test('generator creates only fixed branch and one note PR; rerun reuses without overwriting manual note',async()=>{
 const f=fixture();assert.equal((await f.run(false)).status,'created-pr');f.state.notes[0].title='Manual refinement';
 const writes=clone(f.state.writes);assert.equal((await f.run(false)).status,'existing-pr');assert.deepEqual(f.state.writes,writes);assert.equal(f.state.notes[0].title,'Manual refinement');
});
test('PR creation failure preserves branch; retry creates PR without another commit',async()=>{
 const f=fixture();f.state.failPR=true;await assert.rejects(f.run(false));assert.equal(f.state.branch,'note-head');f.state.failPR=false;
 assert.equal((await f.run(false)).status,'created-pr');assert.equal(f.state.writes.filter(x=>x==='commit').length,1);
});
test('note branch recursion is excluded even if label accidentally attached',async()=>{const f=fixture();f.state.source.head.ref='automation/release-note/pr-500';assert.equal((await f.run(false)).status,'excluded');assert.deepEqual(f.state.writes,[]);});
test('unmerged or non-main source is excluded',async()=>{for(const mutate of [p=>p.merged_at=null,p=>p.base.ref='other']){const f=fixture();mutate(f.state.source);assert.equal((await f.run(false)).status,'excluded');}});
test('main movement and unexpected branch files stop without writes',async()=>{
 for(const mutate of [s=>s.parent='old-main',s=>s.files.push({filename:'collector.py',status:'modified'})]){const f=fixture();f.state.branch='note-head';f.state.notes=appendNote(existing,source(),repository).notes;mutate(f.state);await assert.rejects(f.run(false));assert.deepEqual(f.state.writes,[]);}
});
test('closed note PR is not automatically recreated',async()=>{const f=fixture();f.state.branch='note-head';f.state.notes=appendNote(existing,source(),repository).notes;f.state.closed=[{number:1000}];await assert.rejects(f.run(false));assert.deepEqual(f.state.writes,[]);});
test('existing ID in main does not create branch',async()=>{const f=fixture();f.github.rest.repos.getContent=async()=>({data:{encoding:'base64',content:Buffer.from(JSON.stringify(appendNote(existing,source(),repository).notes)).toString('base64')}});assert.equal((await f.run(false)).status,'already-recorded');assert.deepEqual(f.state.writes,[]);});
test('reconciliation requires cutover and defaults to read-only',async()=>{
 const f=fixture();await assert.rejects(reconcile({github:f.github,repository,since:''}));
 assert.equal((await reconcile({github:f.github,repository,since:'2026-10-15T00:00:00Z'}))[0].status,'would-create-pr');assert.deepEqual(f.state.writes,[]);
});
test('note PR API validation checks exact source, file diff and preservation',async()=>{
 const f=fixture();f.state.notes=appendNote(existing,source(),repository).notes;
 f.state.notePR={number:1000,head:{ref:'automation/release-note/pr-999',sha:'note-head',repo:{full_name:repository}},base:{ref:'main',sha:'base',repo:{full_name:repository}},body:noteBody(source()),labels:[]};
 assert.equal((await validateNotePullRequest({github:f.github,repository,number:1000})).status,'valid-note-pr');
 f.state.files.push({filename:'other',status:'added'});await assert.rejects(validateNotePullRequest({github:f.github,repository,number:1000}));
});
test('actual guard source produces expected errors without relying on subprocess availability',()=>{
 const code=readFileSync(new URL('../scripts/validate_release_note.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
 for(const [body,labels,exit] of [[source().body,['release-note'],0],['## Summary\nx',[],1],[noteBody(source()),[],0],['<!--\n## No Release Note\nReason: hidden\n-->','',1]]){
 const process={env:{PR_BODY:body,PR_LABELS:JSON.stringify(labels)},exitCode:0};runInNewContext(code,{process,parseReleaseDecision,console:{log(){},error(){}}});assert.equal(process.exitCode,exit);
 }
});
test('main changes immediately before writing: stop without creating a ref',async()=>{
 const f=fixture();const get=f.github.rest.git.getRef;let reads=0;
 f.github.rest.git.getRef=async args=>args.ref==='heads/main'&&++reads>1?{data:{object:{sha:'new-main'}}}:get(args);
 await assert.rejects(f.run(false),/Main moved/);assert.deepEqual(f.state.writes,[]);
});
test('racing branch creation never force-updates existing ref',async()=>{
 const f=fixture();f.github.rest.git.createRef=async()=>{throw Object.assign(new Error(),{status:422})};
 await assert.rejects(f.run(false),/raced/);assert.equal(f.state.writes.includes('pr'),false);
});
test('racing PR creation returns the one existing PR without opening another',async()=>{
 const f=fixture();f.github.rest.pulls.create=async args=>{f.state.open=[{number:1000,body:args.body,labels:[]}];throw Object.assign(new Error(),{status:422})};
 assert.equal((await f.run(false)).status,'existing-pr');
});
test('source URL and foreign repository are rejected before writes',async()=>{
 for(const mutate of [p=>p.html_url='https://evil.invalid/pull/999',p=>p.base.repo.full_name='other/repo']){
  const f=fixture();mutate(f.state.source);await assert.rejects(f.run(false));assert.deepEqual(f.state.writes,[]);
 }
});
