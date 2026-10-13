export class InputError extends Error {status:number;constructor(status:number,message:string);}
export function employeeNumber(input:unknown):string;
export function parseEmployees(input:unknown):string[];
export function listQuery(params:URLSearchParams):{search:string;status:string;page:number;page_size:number};
