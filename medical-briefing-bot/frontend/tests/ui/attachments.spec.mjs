import { test, expect } from '@playwright/test';
import { cookieName } from '../../src/lib/customer-auth/core.mjs';
import { createAdminSessionToken, ADMIN_SESSION_COOKIE_NAME } from '../../src/lib/adminAuth.mjs';
const ID='33333333-3333-4333-8333-333333333333';
const AID='44444444-4444-4444-8444-444444444444';
const when='2026-10-16T02:00:00Z';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GioAAAAASUVORK5CYII=','base64');
async function setup(page,context,{internal=false,failPart=false,status='pending',lostCreate=false}={}) {
  await context.addCookies([{name:internal?ADMIN_SESSION_COOKIE_NAME:cookieName('admin',true),value:internal?createAdminSessionToken('ui-local-internal-password-123456'):'a'.repeat(43),url:internal?'http://127.0.0.1:3027':'https://127.0.0.1/',secure:!internal,httpOnly:true}]);
  let creates=0; let parts=0; let attached=false;
  const keys=new Set();
  const request={id:ID,request_number:6,title:'첨부 테스트',description:'보존할 요청 내용',priority:'normal',status:'received',version:1,created_at:when,updated_at:when,closed_at:null,...(internal?{requester_admin_id:'11111111-1111-4111-8111-111111111111'}:{})};
  await page.route(/\/api\/(?:customer-admin|admin)\/support\//,async route=>{
    const url=new URL(route.request().url()); const method=route.request().method();
    if(url.pathname.includes('/attachments')) {
      if(url.pathname.endsWith('/download')) return route.fulfill({contentType:'image/png',body:png});
      if(url.pathname.includes('/parts/')) {parts++; if(failPart) {failPart=false; return route.fulfill({status:503,json:{error:'SUPPORT_UNAVAILABLE'}});} return route.fulfill({json:{ok:true}});}
      if(url.pathname.endsWith('/complete')) {attached=true; return route.fulfill({json:{ok:true}});}
      if(method==='POST') return route.fulfill({status:201,json:{id:AID,expires_at:when,uploaded:false,token:'t'.repeat(43),part_bytes:1048576}});
      if(method==='DELETE') {attached=false; return route.fulfill({json:{ok:true}});}
      return route.fulfill({json:{attachments:attached||internal?[{id:AID,original_name:'screen.png',mime:'image/png',bytes:png.length,scan_status:status,upload_status:'uploaded',created_at:when}]:[]}});
    }
    if(method==='POST') {const key=route.request().headers()['x-support-request-key'];if(!keys.has(key)){creates++;keys.add(key);}if(lostCreate){lostCreate=false;return route.abort('failed');}return route.fulfill({status:201,json:{request}});}
    if(url.pathname.endsWith('/requests')) return route.fulfill({json:{requests:[request],total:1,page:1,page_size:10}});
    return route.fulfill({json:{request,comments:[],comments_total:0,page:1,page_size:10,...(internal?{notes:[],notes_total:0,history:[],history_total:0,audit:[],audit_total:0}:{})}});
  });
  await page.goto(internal?'/admin/support':'/customer-admin/support');
  return {counts:()=>({creates,parts})};
}
test('partial upload failure preserves fields and retries attachments without creating another request',async({page,context})=>{
  const mock=await setup(page,context,{failPart:true});
  await page.getByRole('button',{name:'새 요청 등록'}).click();
  await page.getByLabel('제목 (필수)').fill('입력 보존'); await page.getByLabel('상세 내용 (필수)').fill('실패 후에도 보존할 내용');
  await page.getByLabel('첨부파일',{exact:true}).setInputFiles({name:'screen.png',mimeType:'image/png',buffer:png});
  await expect(page.getByAltText('screen.png 선택 미리보기')).toBeVisible();
  await page.getByRole('button',{name:'요청 등록',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('업로드에 실패');
  await expect(page.getByLabel('상세 내용 (필수)')).toHaveValue('실패 후에도 보존할 내용');
  await page.getByRole('button',{name:'첨부 재시도',exact:true}).click();
  await expect(page.getByRole('region',{name:'요청 첨부파일'})).toContainText('검사 대기');
  expect(mock.counts()).toEqual({creates:1,parts:2});
  await expect(page.getByRole('link',{name:'다운로드',exact:true})).toHaveCount(0);
  await expect(page.locator('main img')).toHaveCount(0);
});
test('mobile picker validates five files and size, removes selection and supports image paste',async({page,context})=>{
  await page.setViewportSize({width:390,height:844}); await setup(page,context);
  await page.getByRole('button',{name:'새 요청 등록'}).click();
  await page.getByLabel('첨부파일',{exact:true}).setInputFiles(Array.from({length:6},(_,i)=>({name:`${i}.png`,mimeType:'image/png',buffer:png})));
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('최대 5개');
  await page.getByLabel('첨부파일',{exact:true}).setInputFiles({name:'big.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(10485761)});
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('10MB');
  await page.getByLabel('첨부파일',{exact:true}).setInputFiles({name:'screen.png',mimeType:'image/png',buffer:png});
  await page.getByRole('button',{name:'screen.png 제거',exact:true}).click();
  await expect(page.getByAltText('screen.png 선택 미리보기')).toHaveCount(0);
  await page.getByRole('region',{name:'파일 첨부'}).evaluate(element=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71])],'pasted.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  await expect(page.getByRole('region',{name:'파일 첨부'})).toContainText('pasted.png');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('request response loss reuses the creation key before uploading',async({page,context})=>{
  const mock=await setup(page,context,{lostCreate:true});await page.getByRole('button',{name:'새 요청 등록'}).click();
  await page.getByLabel('제목 (필수)').fill('응답 유실 복구');await page.getByLabel('상세 내용 (필수)').fill('같은 내용으로 재시도');
  await page.getByLabel('첨부파일',{exact:true}).setInputFiles({name:'screen.png',mimeType:'image/png',buffer:png});
  await page.getByRole('button',{name:'요청 등록',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'요청 등록',exact:true}).click();await expect(page.getByRole('region',{name:'요청 첨부파일'})).toContainText('검사 대기');
  expect(mock.counts()).toEqual({creates:1,parts:1});
});
for (const [extension, mimeType] of [['pdf','application/pdf'], ['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]) test(`customer selects and uploads ${extension} document through the existing uploader`, async ({page,context}) => {
  const mock=await setup(page,context);
  const reservations=[];
  page.on('request', request => { if(request.method()==='POST' && request.url().endsWith('/attachments')) reservations.push(request.postDataJSON()); });
  await page.getByRole('button',{name:'새 요청 등록'}).click();
  await page.getByLabel('제목 (필수)').fill('문서 첨부 문의');
  await page.getByLabel('상세 내용 (필수)').fill('선택한 문서를 첨부합니다.');
  await page.getByLabel('첨부파일',{exact:true}).setInputFiles({name:`문의자료.${extension}`,mimeType,buffer:Buffer.from('mock storage content')});
  await expect(page.getByRole('region',{name:'파일 첨부'})).toContainText(`문의자료.${extension}`);
  await expect(page.getByRole('dialog').locator('img')).toHaveCount(0);
  await page.getByRole('button',{name:'요청 등록',exact:true}).click();
  await expect(page.getByRole('region',{name:'요청 첨부파일'})).toBeVisible();
  expect(mock.counts()).toEqual({creates:1,parts:1});
  expect(reservations).toHaveLength(1);
  expect(reservations[0].original_name).toBe(`문의자료.${extension}`);
  expect(reservations[0].mime).toBe(mimeType);
});
for(const status of ['pending','scanning','infected','failed','clean']) test(`internal attachment ${status} exposes downloads only for clean`,async({page,context})=>{
  await setup(page,context,{internal:true,status}); await page.getByRole('button',{name:'요청 #6 상세 보기'}).click();
  await expect(page.getByRole('region',{name:'요청 첨부파일'})).toContainText('screen.png');
  await expect(page.getByRole('link',{name:'다운로드',exact:true})).toHaveCount(status==='clean'?1:0);
  await expect(page.locator('main img')).toHaveCount(status==='clean'?1:0);
  if(status==='clean') await expect(page.locator('main img')).toBeVisible();
});
