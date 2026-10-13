import type { CustomerAuthService } from './core.mjs';
export class ManagementError extends Error { status:number; constructor(status:number,message:string); }
export function employeeNumber(input:unknown):string;
export function parseEmployees(input:unknown):string[];
export function listQuery(params:URLSearchParams): {search:string;status:string;page:number;page_size:number};
export interface ManagementRepository { call(operation:string,payload:Record<string,unknown>):Promise<Record<string, unknown>>; }
export class CustomerAdminManagement {
 constructor(auth:CustomerAuthService,repository:ManagementRepository);
 list(token:string,query:Record<string,unknown>):Promise<unknown>;
 audit(token:string,query:Record<string,unknown>):Promise<unknown>;
 add(token:string,input:unknown,bulk?:boolean):Promise<unknown>;
 status(token:string,id:string,active:unknown):Promise<unknown>;
 password(token:string,password:unknown,confirmation:unknown,adminPassword:unknown,keys:{ip:string;identity:string}):Promise<unknown>;
}
export function reauthKeys(adminId:string,ip:string,secret:string):{ip:string;identity:string};
