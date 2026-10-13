import { History, ChevronRight } from 'lucide-react';
import type { CustomerActivity } from '@/lib/customerAdminMockData';

export default function ActivityHistory({ activities, onViewAll }: { activities: CustomerActivity[]; onViewAll: () => void }) {
  return <section className="ca-card min-w-0" aria-labelledby="activity-title"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="activity-title" className="ca-card-title"><History size={20} className="text-blue-600" />최근 관리 이력</h2><button type="button" className="ca-text-button" onClick={onViewAll}>전체보기<ChevronRight size={15} /></button></div><p className="mt-3 text-sm leading-6 text-slate-500">사번 추가, 상태 변경, 비밀번호 변경 등의 이력을 확인할 수 있습니다.</p><ActivityList activities={activities.slice(0, 6)} /></section>;
}

export function ActivityList({ activities }: { activities: CustomerActivity[] }) {
  return <>
    <table className="mt-5 hidden w-full table-fixed text-left text-xs sm:table"><thead><tr className="border-y border-slate-100 bg-slate-50 text-slate-500"><th scope="col" className="w-[34%] px-2 py-3 font-medium">일시 (KST)</th><th scope="col" className="px-2 py-3 font-medium">작업 내용</th><th scope="col" className="w-16 px-2 py-3 font-medium">작업자</th></tr></thead><tbody>{activities.map(activity => <tr key={activity.id} className="border-b border-slate-100"><td className="px-2 py-4 leading-5 text-slate-500">{activity.at}</td><td className="break-words px-2 py-4 leading-5 font-medium text-slate-700">{activity.action}</td><td className="px-2 py-4 text-slate-500">{activity.actor}</td></tr>)}</tbody></table>
    <ul className="mt-5 divide-y divide-slate-100 sm:hidden">{activities.map(activity => <li key={activity.id} className="py-3.5"><p className="break-words text-sm font-medium text-slate-700">{activity.action}</p><div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><time>{activity.at} KST</time><span>{activity.actor}</span></div></li>)}</ul>
  </>;
}
