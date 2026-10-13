export type AdminUser = { id:string; employee_number:string; active:boolean; created_at:string; updated_at:string; disabled_at:string|null };
export type AdminEvent = { id:string; action:string; occurred_at:string; actor:string|null; target:string|null };
export type UserResult = { users:AdminUser[];total:number;page:number;page_size:number;stats:{total:number;active:number;inactive:number};admin:{id:string;login_id:string;designation:string};credential:{configured:boolean;updated_at:string|null} };
export type AuditResult = { events:AdminEvent[];total:number;page:number;page_size:number };
export class AdminApiError extends Error { status:number; constructor(status:number,message:string){super(message);this.status=status;} }
export async function adminRequest<T>(path:string,options?:RequestInit):Promise<T> {
  let response:Response;
  try{response=await fetch(`/api/customer-admin/${path}`,{...options,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...options?.headers}});}catch{throw new AdminApiError(503,'서비스 연결을 확인할 수 없습니다.');}
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new AdminApiError(response.status,data?.error||'요청을 처리할 수 없습니다.');
  return data as T;
}
export const formatAdminDate=(value:string|null,includeTime=false)=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',...(includeTime?{hour:'2-digit',minute:'2-digit',hourCycle:'h23' as const}:{})}).format(new Date(value)):'—';
export const safeAdminNext=(value:unknown)=>value==='/customer-admin'?value:'/customer-admin';
export const actionLabel=(event:AdminEvent)=>({employee_added:`사번 ${event.target||'—'} 추가`,employee_activated:`사번 ${event.target||'—'} 활성화`,employee_disabled:`사번 ${event.target||'—'} 비활성화`,shared_password_changed:'공용 비밀번호 변경',admin_login:'관리자 로그인',failed_admin_login:'관리자 로그인 실패'}[event.action]||'관리 작업');

export type DisplayUser = { id:string;employeeNo:string;active:boolean;createdAt:string;updatedAt:string };
export type DisplayActivity = {id:string;at:string;action:string;actor:string};
