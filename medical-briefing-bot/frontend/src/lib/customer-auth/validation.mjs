export class InputError extends Error { constructor(status,message){super(message);this.status=status;} }
export function employeeNumber(input) {
  if (typeof input !== 'string') throw new InputError(400,'사번을 확인해 주세요.');
  const value=input.trim();
  if (!value || value.length>64 || /[\s\p{Cc}]/u.test(value)) throw new InputError(400,'사번은 공백 없이 1~64자로 입력해 주세요.');
  return value;
}
export function parseEmployees(input) {
  const values=Array.isArray(input)?input:typeof input==='string'?input.split(/[,\r\n]+/).filter(value=>value.trim()):[];
  if (!values.length || values.length>100) throw new InputError(400,'한 번에 1~100개의 사번을 입력해 주세요.');
  const numbers=values.map(employeeNumber);
  if (new Set(numbers).size!==numbers.length) throw new InputError(409,'입력한 사번에 중복이 있습니다.');
  return numbers;
}
export function listQuery(params) {
  const search=(params.get('search')||'').trim(); const status=params.get('status')||'all';
  const pageText=params.get('page')||'1'; const sizeText=params.get('page_size')||'10';
  if(search.length>64 || /\p{Cc}/u.test(search) || !['all','active','inactive'].includes(status) || !/^\d{1,6}$/.test(pageText) || !/^\d{1,2}$/.test(sizeText))throw new InputError(400,'조회 조건을 확인해 주세요.');
  const page=Number(pageText),page_size=Number(sizeText);
  if(page<1||page>100000||page_size<1||page_size>50)throw new InputError(400,'페이지 범위를 확인해 주세요.');
  return {search,status,page,page_size};
}
