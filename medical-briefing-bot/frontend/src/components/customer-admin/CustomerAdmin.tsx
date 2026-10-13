'use client';

import { useState } from 'react';
import { Activity, ChevronDown, ChevronRight, LockKeyhole, LogOut, UserRound, ShieldCheck } from 'lucide-react';
import { mockActivities, mockAdministrator, mockTimestamp, mockUsers, type CustomerActivity } from '@/lib/customerAdminMockData';
import UserManagement from './UserManagement';
import { AddUsersDialog, ChangePasswordDialog, PasswordWarning } from './AccountDialogs';
import ActivityHistory, { ActivityList } from './ActivityHistory';
import Dialog from './Dialog';
import './customer-admin.css';

type OpenDialog = 'add' | 'bulk' | 'password' | 'history' | 'password-history' | 'account' | null;

export default function CustomerAdmin() {
  const [users, setUsers] = useState(() => mockUsers.map(user => ({ ...user })));
  const [activities, setActivities] = useState<CustomerActivity[]>(() => [...mockActivities]);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [notice, setNotice] = useState('');
  const close = () => setDialog(null);
  function record(action: string, at: string) {
    setActivities(previous => [{ id: crypto.randomUUID(), action, at, actor: mockAdministrator }, ...previous]);
  }
  function addUsers(numbers: string[]) {
    const at = mockTimestamp();
    setUsers(previous => [...numbers.map(employeeNo => ({ employeeNo, active: true, createdAt: at.slice(0, 10), updatedAt: at.slice(0, 10) })), ...previous]);
    record(numbers.length === 1 ? `사번 ${numbers[0]} 추가` : `사번 ${numbers.length}명 일괄 등록`, at);
    setNotice(`${numbers.length}명의 사용자를 시안에 임시 등록했습니다.`);
    close();
  }
  function toggleUser(employeeNo: string) {
    const user = users.find(value => value.employeeNo === employeeNo);
    if (!user) return;
    const at = mockTimestamp();
    setUsers(previous => previous.map(value => value.employeeNo === employeeNo ? { ...value, active: !value.active, updatedAt: at.slice(0, 10) } : value));
    record(`사번 ${employeeNo} ${user.active ? '비활성화' : '활성화'}`, at);
    setNotice(`사번 ${employeeNo}의 시안 상태를 변경했습니다. 실제 접근 권한은 변경되지 않습니다.`);
  }
  return <div className="customer-admin min-h-screen bg-[#F7F9FC] text-slate-800">
    <header className="border-b border-slate-200/80 bg-white"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8 lg:px-10"><div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white"><Activity size={24} /></span><div><p className="text-lg font-bold tracking-tight">Medical Briefing</p><p className="mt-0.5 text-xs text-slate-500 sm:text-sm">의료 전문가를 위한 AI 브리핑 서비스</p></div></div><div className="flex w-full items-center justify-end gap-2 sm:w-auto"><button type="button" className="ca-secondary border-transparent px-2" onClick={() => setDialog('account')}><UserRound size={18} /><span className="text-sm">관리자 {mockAdministrator}님</span><ChevronDown size={15} /></button><span className="h-5 w-px bg-slate-200" /><button type="button" className="ca-text-button px-2" onClick={() => setNotice('UI 시안에는 로그인 세션이 없어 실제 로그아웃은 수행하지 않습니다.')}><LogOut size={16} />로그아웃</button></div></div></header>
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-10 lg:px-10">
      <div className="mb-7"><div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700"><ShieldCheck size={14} />UI 시안 · 샘플 데이터</div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">고객 계정 관리</h1><p className="mt-3 text-sm text-slate-500 sm:text-base">서비스에 접근할 수 있는 사번을 관리합니다.</p><p className="mt-2 text-xs leading-5 text-slate-500">실제 인증·DB와 연결되지 않은 미리보기입니다. 변경사항은 새로고침하면 초기화됩니다.</p></div>
      <div role="status" aria-live="polite" aria-atomic="true">{notice && <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">{notice}</div>}</div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]"><UserManagement users={users} onAdd={() => setDialog('add')} onBulk={() => setDialog('bulk')} onToggle={toggleUser} /><div className="grid min-w-0 gap-6 md:grid-cols-2 xl:grid-cols-1">
        <section className="ca-card min-w-0" aria-labelledby="password-title"><h2 id="password-title" className="ca-card-title"><LockKeyhole size={20} className="text-blue-600" />공용 비밀번호</h2><p className="mt-3 text-sm leading-6 text-slate-500">모든 사용자가 공유하는 로그인 비밀번호입니다.</p><button type="button" className="ca-text-button mt-2" onClick={() => setDialog('password-history')}>비밀번호 변경 이력<ChevronRight size={15} /></button><dl className="my-5 space-y-4 rounded-xl bg-slate-50 p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-500">마지막 변경</dt><dd className="font-medium">2026. 10. 13 10:30</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500">현재 상태</dt><dd className="flex items-center gap-2 font-medium text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />정상</dd></div></dl><PasswordWarning /><button type="button" className="ca-primary mt-5 w-full" onClick={() => setDialog('password')}>공용 비밀번호 변경</button></section>
        <ActivityHistory activities={activities} onViewAll={() => setDialog('history')} />
      </div></div>
    </main>
    {(dialog === 'add' || dialog === 'bulk') && <AddUsersDialog bulk={dialog === 'bulk'} users={users} onClose={close} onAdd={addUsers} />}
    {dialog === 'password' && <ChangePasswordDialog onClose={close} onConfirm={() => { close(); setNotice('시안의 비밀번호 입력 검증이 완료되었습니다. 비밀번호를 저장하거나 변경하지 않았으며 실제 세션도 만료되지 않았습니다.'); }} />}
    {(dialog === 'history' || dialog === 'password-history') && <Dialog title={dialog === 'history' ? '전체 관리 이력' : '비밀번호 변경 이력'} description="UI 확인용 샘플 이력입니다. 실제 고객 작업 기록이 아닙니다." onClose={close}><ActivityList activities={dialog === 'history' ? activities : activities.filter(activity => activity.action === '공용 비밀번호 변경')} /></Dialog>}
    {dialog === 'account' && <Dialog title="관리자 정보" description="김지훈은 고객 승인 시안의 샘플 이름입니다. 실제 관리자 계정과 연결되어 있지 않습니다." onClose={close}><button type="button" className="ca-primary mt-6" onClick={close}>확인</button></Dialog>}
  </div>;
}
