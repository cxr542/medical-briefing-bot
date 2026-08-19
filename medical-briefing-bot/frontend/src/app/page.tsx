import { supabase } from '@/lib/supabase';
import { Calendar } from 'lucide-react';
import ArticleList from '@/components/ArticleList';

export const revalidate = 60; // 60초 단위 캐시 갱신 (ISR)

export default async function Dashboard() {
  // Supabase에서 기사 조회 (발행일 기준 내림차순)
  const { data: articles, error } = await supabase
    .from('articles')
    .select('*')
    .order('published_date', { ascending: false });

  if (error) {
    console.error(error);
    return <div className="p-10 text-center text-red-500">데이터를 불러오는 중 오류가 발생했습니다.</div>;
  }

  // 한국 시간 기준으로 현재 시간 생성
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = { 
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  const today = now.toLocaleDateString('ko-KR', options);

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#333333] font-sans pb-20">
      {/* Header */}
      <header className="bg-[#5C2D0C] text-white py-5 px-4 md:px-8 flex flex-col md:flex-row items-center justify-between shadow-md sticky top-0 z-10 gap-3 md:gap-0 print:hidden">
        <h1 className="text-lg md:text-2xl font-bold flex items-center gap-2">
          🏥 병원·보건의료 종합 모닝 브리핑
        </h1>
        <div className="flex items-center gap-2 bg-white/20 px-4 py-1.5 rounded-full text-xs md:text-sm">
          <Calendar className="w-4 h-4" />
          <span>최종 업데이트: {today}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] w-[95%] mx-auto mt-8 md:mt-12">
        {/* 클라이언트 컴포넌트(검색 및 렌더링)에 데이터 전달 */}
        <ArticleList initialArticles={articles || []} />
      </main>
    </div>
  );
}
