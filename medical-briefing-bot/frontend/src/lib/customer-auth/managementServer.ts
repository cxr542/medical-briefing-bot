import 'server-only';
import { isIP } from 'node:net';
import { createAdminSupabaseClient } from '@/lib/adminSupabase';
import { getAdminSessionToken, hasSameOrigin } from '@/lib/adminAuth.mjs';
import { createCustomerAuthService, readBody } from './server';
import { readSessionCookie } from './core.mjs';
import { InputError } from './validation.mjs';
import { CustomerAdminManagement, ManagementError, listQuery, reauthKeys } from './management.mjs';

const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, max-age=0',...(status===429?{'Retry-After':'900'}:{})}});
export async function managementApi(request:Request,operation:'list'|'add'|'bulk'|'status'|'password'|'audit',id?:string) {
  const token=readSessionCookie(request,'admin');
  if(!token)return response({error:'관리자 로그인이 필요합니다.'},readSessionCookie(request,'user')||getAdminSessionToken(request.headers.get('cookie'))?403:401);
  try {
    const auth=createCustomerAuthService();
    const principal=await auth.authorize('admin',token);
    if(!principal)return response({error:'관리자 로그인이 필요합니다.'},401);
    const mutation=!['list','audit'].includes(operation);
    if(mutation&&!hasSameOrigin(request))return response({error:'요청을 처리할 수 없습니다.'},403);
    const client=createAdminSupabaseClient();
    const service=new CustomerAdminManagement(auth,{async call(op,payload){
      const {data,error}=await client.rpc('customer_admin_rpc',{operation:op,payload});
      if(error){
        const code=error.code;
        if(code==='23505')throw new ManagementError(409,'이미 등록된 사번이 있습니다. 전체 등록이 취소되었습니다.');
        if(['22023','23514','22P02'].includes(code))throw new ManagementError(400,'입력 내용을 확인해 주세요.');
        if(code==='P0002')throw new ManagementError(404,'사용자를 찾을 수 없습니다.');
        if(code==='42501')throw new ManagementError(401,'관리자 로그인이 필요합니다.');
        if(code==='28000')throw new ManagementError(403,'관리자 재인증이 필요합니다.');
        throw new Error('Management store unavailable');
      }
      return data;
    }});
    if(operation==='list')return response(await service.list(token,listQuery(new URL(request.url).searchParams)));
    if(operation==='audit'){
      const params=new URL(request.url).searchParams;
      return response(await service.audit(token,{...listQuery(params),action:params.get('action')||'all'}));
    }
    const body=await readBody(request,16384);
    if(!body)return response({error:'입력 내용을 확인해 주세요.'},400);
    if(operation==='add')return response(await service.add(token,body.employee_number),201);
    if(operation==='bulk')return response(await service.add(token,body.employee_numbers,true),201);
    if(operation==='status')return response(await service.status(token,id||'',body.active));
    const header=request.headers.get('x-vercel-forwarded-for')||'';
    const keys=reauthKeys(principal.id,isIP(header)?header:'unknown',process.env.CUSTOMER_AUTH_RATE_LIMIT_SECRET||'');
    return response(await service.password(token,body.password,body.confirmation,body.admin_password,keys));
  }catch(error){
    return (error instanceof ManagementError || error instanceof InputError)?response({error:error.message},error.status):response({error:'서비스 연결을 확인할 수 없습니다.'},503);
  }
}
