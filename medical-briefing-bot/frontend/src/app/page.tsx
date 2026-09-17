import { supabase } from '@/lib/supabase';
import { Calendar, Sparkles } from 'lucide-react';
import Image from 'next/image';
import Link from "next/link";

import ArticleList from '@/components/ArticleList';
import CollectionStatusBanner from '@/components/CollectionStatusBanner';
import { COLLECTION_SCHEDULE_KST, getCollectionServiceStatus, getLatestCollectionTime } from '@/lib/collectionStatus';

export const revalidate = 60; // 60초 단위 캐시 갱신 (ISR)

export default async function Dashboard() {
  // Supabase에서 초기 데이터 100건만 제한적으로 조회 (대용량 대비 서버사이드 최적화)
  // 14일치 데이터를 가져와 넉넉하게 풀을 확보 (limit 대신 날짜 기반 필터링)
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const [{ data: articles, error }, { data: latestRun }] = await Promise.all([
    supabase
      .from('articles')
      .select('*')
      .gte('published_date', fourteenDaysAgo.toISOString())
      .order('published_date', { ascending: false })
      .limit(500),
    supabase
      .from('collector_runs')
      .select('started_at,finished_at,result,collected_count,ai_output_count,db_attempted,db_succeeded,db_failed,source_health')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (error) {
    console.error(error);
    return <div className="p-10 text-center text-red-500">데이터를 불러오는 중 오류가 발생했습니다.</div>;
  }

  const now = new Date();
  const kstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const isBeforeFirstRun = kstDate.getHours() * 60 + kstDate.getMinutes() < 6 * 60;
  if (isBeforeFirstRun) {
    kstDate.setDate(kstDate.getDate() - 1);
  }
  
  const year = kstDate.getFullYear();
  const month = kstDate.getMonth() + 1;
  const date = kstDate.getDate();
  
  const formattedDate = `${year}년 ${month}월 ${date}일 ${getLatestCollectionTime(now)}`;

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#191919] font-sans pb-20">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-[#F8F9FA]/95 px-4 py-4 backdrop-blur md:px-8 print:hidden">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3" title="홈으로 새로고침">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#FEE500] text-xl shadow-sm">✦</span>
            <span><span className="block text-xs font-bold uppercase tracking-[0.22em] text-[#1D4ED8]">Medical Briefing</span><span className="text-sm font-bold text-[#191919] md:text-base">병원·보건의료 종합 브리핑</span></span>
          </Link>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm md:px-4">
            <Calendar className="h-4 w-4 text-[#1D4ED8]" /> <span>마지막 확인 {formattedDate}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] w-full px-4 md:px-8 xl:px-12 mx-auto mt-6 md:mt-8">
        <section className="mb-6 grid overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(29,78,216,0.09)] md:grid-cols-[1fr_260px]">
          <div className="p-6 md:p-9"><div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#FEE500] px-3 py-1.5 text-xs font-black text-[#191919]"><Sparkles className="h-3.5 w-3.5" /> 오늘의 브리핑</div><h1 className="max-w-2xl text-3xl font-black tracking-tight text-[#191919] md:text-5xl">의료·보건 소식,<br /><span className="text-[#1D4ED8]">따뜻하게 한눈에.</span></h1><p className="mt-4 max-w-xl text-sm leading-6 text-slate-600 md:text-base">복잡한 의료 뉴스를 곰돌이 브리퍼와 함께 가볍게 살펴보세요. 매일 필요한 소식을 한곳에 모았어요.</p><div className="mt-6 flex flex-wrap gap-2" aria-label="수집 일정">{COLLECTION_SCHEDULE_KST.map(time => <span key={time} className={`rounded-full px-3 py-1.5 text-xs font-bold ${time === getLatestCollectionTime(now) ? 'bg-[#FEE500] text-[#191919]' : 'bg-slate-100 text-slate-600'}`}>{time}</span>)}</div></div>
          <div className="flex max-h-60 items-end justify-center overflow-hidden bg-[#FFF8D8] px-4 pt-2 md:max-h-64 md:px-6"><Image src="/medical-briefing-bear.png" alt="Medical Briefing 곰돌이 캐릭터" width={1374} height={1145} className="h-auto max-h-56 w-full max-w-[27rem] object-contain object-bottom md:max-h-64" priority /></div>
        </section>
        <CollectionStatusBanner status={getCollectionServiceStatus(latestRun)} />
        {/* 클라이언트 컴포넌트(검색 및 렌더링)에 데이터 전달 */}
        <ArticleList initialArticles={articles || []} />
      </main>
    </div>
  );
}
