// UI fixtures only. Never persisted or sent to an API.
export type CustomerUser = { employeeNo: string; active: boolean; createdAt: string; updatedAt: string };
export type CustomerActivity = { id: string; at: string; action: string; actor: string };
export const mockAdministrator = '김지훈';
export const mockUsers: CustomerUser[] = Array.from({ length: 10 }, (_, index) => {
  const date = `2026.10.${index < 3 ? '13' : index < 5 ? '12' : index < 7 ? '11' : '10'}`;
  return { employeeNo: String(100123 + index), active: index !== 2, createdAt: date, updatedAt: index === 7 ? '2026.10.12' : date };
});
export const mockActivities: CustomerActivity[] = [
  ['2026.10.13 10:30', '공용 비밀번호 변경'],
  ['2026.10.13 09:42', '사번 100125 비활성화'],
  ['2026.10.12 16:20', '사번 100130 추가'],
  ['2026.10.12 14:11', '사번 100128 추가'],
  ['2026.10.11 15:33', '사번 100120 활성화'],
  ['2026.10.10 11:05', '사번 100118 비활성화'],
].map(([at, action], index) => ({ id: `fixture-${index}`, at, action, actor: mockAdministrator }));
export function validateEmployeeNumbers(input: string, existing: CustomerUser[]) {
  const numbers = input.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (!numbers.length) return { numbers, error: '사번을 입력해 주세요.' };
  if (numbers.some(value => !/^\d{6}$/.test(value))) return { numbers, error: '시안에서는 숫자 6자리 사번을 입력해 주세요. 선행 0은 유지됩니다.' };
  if (new Set(numbers).size !== numbers.length) return { numbers, error: '입력한 사번에 중복이 있습니다.' };
  if (numbers.some(value => existing.some(user => user.employeeNo === value))) return { numbers, error: '이미 등록된 사번이 있습니다. 비활성 사용자도 확인해 주세요.' };
  if (numbers.length > 100) return { numbers, error: '한 번에 최대 100명까지 입력해 주세요.' };
  return { numbers, error: '' };
}
export function validateMockPassword(password: string, confirmation: string) {
  if (password.length < 12) return '새 비밀번호는 12자 이상 입력해 주세요.';
  if (password !== confirmation) return '두 비밀번호가 일치하지 않습니다.';
  return '';
}
export function mockTimestamp() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}
