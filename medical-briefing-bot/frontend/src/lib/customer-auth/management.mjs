import { tokenHash, hashPassword, verifyPassword, rateKeys } from './core.mjs';
export class ManagementError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
export { employeeNumber, parseEmployees, listQuery } from './validation.mjs';
import { employeeNumber, parseEmployees } from './validation.mjs';
// Project public DTOs explicitly; never forward a repository row wholesale to HTTP.
const pick=(row,keys)=>Object.fromEntries(keys.map(key=>[key,row[key]??null]));
export class CustomerAdminManagement {
  constructor(auth,repository) { this.auth=auth;this.repository=repository; }
  async call(token,operation,payload={}) {
    if (!await this.auth.authorize('admin',token)) throw new ManagementError(401,'관리자 로그인이 필요합니다.');
    return this.repository.call(operation,{...payload,admin_token_hash:tokenHash(token)});
  }
  async list(token,query) {
    const data=await this.call(token,'list_users',query);
    return {users:data.users.map(u=>pick(u,['id','employee_number','active','created_at','updated_at','disabled_at'])),total:data.total,page:data.page,page_size:data.page_size,
      stats:pick(data.stats,['total','active','inactive']),admin:pick(data.admin,['id','login_id','designation']),credential:pick(data.credential,['configured','updated_at'])};
  }
  async audit(token,query) {
    const action=query.action||'all';
    if(!['all','employee_added','employee_activated','employee_disabled','shared_password_changed','admin_login','failed_admin_login'].includes(action))throw new ManagementError(400,'이력 조회 조건을 확인해 주세요.');
    const data=await this.call(token,'audit',{...query,action});
    return {events:data.events.map(e=>pick(e,['id','action','occurred_at','actor','target'])),total:data.total,page:data.page,page_size:data.page_size};
  }
  async add(token,input,bulk=false) {
    const numbers=bulk?parseEmployees(input):[employeeNumber(input)];
    const result=await this.call(token,bulk?'bulk_add':'add_user',bulk?{employee_numbers:numbers}:{employee_number:numbers[0]});
    return {created:result.created};
  }
  async status(token,id,active) {
    if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||typeof active!=='boolean')throw new ManagementError(400,'사용자 상태를 확인해 주세요.');
    await this.call(token,'set_user_active',{user_id:id,active});return {ok:true};
  }
  async password(token,password,confirmation,adminPassword,keys) {
    if(password!==confirmation)throw new ManagementError(400,'새 비밀번호가 일치하지 않습니다.');
    if(!await this.auth.authorize('admin',token))throw new ManagementError(401,'관리자 로그인이 필요합니다.');
    const limit=await this.auth.repository.call('consume_attempt',keys);
    if(!limit?.allowed)throw new ManagementError(429,'잠시 후 다시 시도해 주세요.');
    const credential=await this.call(token,'reauth_credential');
    if(!await verifyPassword(credential.password_hash,adminPassword)) {
      await this.auth.repository.call('audit_admin_failure',{});
      throw new ManagementError(403,'관리자 비밀번호를 확인해 주세요.');
    }
    let password_hash;
    try{password_hash=await hashPassword(password);}catch{throw new ManagementError(400,'새 비밀번호는 12자 이상, UTF-8 512바이트 이하로 입력해 주세요.');}
    await this.call(token,'rotate_shared',{password_hash,admin_credential_version:credential.credential_version});return {ok:true};
  }
}
export function reauthKeys(adminId,ip,secret) {return rateKeys('admin',`reauth:${adminId}`,ip,secret);}
