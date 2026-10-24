import assert from 'node:assert/strict';
import test from 'node:test';
import { employeeNumber,parseEmployees,listQuery,CustomerAdminManagement } from '../src/lib/customer-auth/management.mjs';
import { safeAdminNext } from '../src/lib/customerAdminApi.ts';

test('employee strings preserve zeros and variable lengths; bulk rejects malformed/duplicates/oversize atomically',()=>{
 assert.equal(employeeNumber(' 001025 '),'001025');assert.equal(employeeNumber('EMP-long-id'),'EMP-long-id');
 assert.deepEqual(parseEmployees('001025, EMP-2\nEMP-3'),['001025','EMP-2','EMP-3']);
 for(const values of ['','a a','a,a',Array.from({length:101},(_,i)=>'E'+i),'x'.repeat(65)])assert.throws(()=>parseEmployees(values));
});
test('query parameters bounded and wildcards remain literal; next never leaves customer admin',()=>{
 assert.equal(listQuery(new URLSearchParams('search=%25_%26')).search,'%_&');
 for(const query of ['page=-1','page=0','page_size=51','status=unknown','search='+encodeURIComponent('x'.repeat(65))])assert.throws(()=>listQuery(new URLSearchParams(query)));
 for(const next of ['https://evil.invalid','//evil.invalid','/admin','/customer-admin/login','/customer-admin/../admin'])assert.equal(safeAdminNext(next),'/customer-admin');
});
test('management projects safe DTO fields and denies unauthorized callers before repository access',async()=>{
 let calls=0;const row={id:'id',employee_number:'001025',active:true,created_at:'date',updated_at:'date',disabled_at:null,password_hash:'never-return',token_hash:'never-return'};
 const repo={async call(op){calls++;return op==='list_users'?{users:[row],stats:{total:1,active:1,inactive:0,secret:'never-return'},admin:{id:'admin',login_id:'primary',designation:'primary',password_hash:'never-return'},credential:{configured:true,updated_at:'date',password_hash:'never-return'},total:1,page:1,page_size:10}:{events:[{id:'event',action:'admin_login',occurred_at:'date',actor:'primary',target:null,metadata:{secret:'never-return'}}],total:1,page:1,page_size:10};}};
 const auth={authorize:async()=>null};const service=new CustomerAdminManagement(auth,repo);
 await assert.rejects(()=>service.list('a'.repeat(43),{}),e=>e.status===401);assert.equal(calls,0);
 auth.authorize=async()=>({id:'admin',kind:'admin'});
 assert.equal(JSON.stringify(await service.list('a'.repeat(43),{})).includes('never-return'),false);
 assert.equal(JSON.stringify(await service.audit('a'.repeat(43),{})).includes('never-return'),false);
});
