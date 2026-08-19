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

  // 데이터 수집이 매일 오전 6시(KST)에 이루어지므로, 가장 최근에 지나간 오전 6시를 계산
  const now = new Date();
  
  // UTC 시간을 KST(UTC+9)로 변환
  const kstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  
  // 만약 현재 KST 시간이 오전 6시 이전이라면, 업데이트 시점은 어제 오전 6시임
  if (kstDate.getHours() < 6) {
    kstDate.setDate(kstDate.getDate() - 1);
  }
  
  const year = kstDate.getFullYear();
  const month = kstDate.getMonth() + 1;
  const date = kstDate.getDate();
  
  const formattedDate = `${year}년 ${month}월 ${date}일 오전 06:00`;

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#333333] font-sans pb-20">
      {/* Header */}
      <header className="bg-[#5C2D0C] text-white py-5 px-4 md:px-8 flex flex-col md:flex-row items-center justify-between shadow-md sticky top-0 z-10 gap-3 md:gap-0 print:hidden">
        <h1 className="text-lg md:text-2xl font-bold flex items-center gap-2">
          🏥 병원·보건의료 종합 모닝 브리핑
        </h1>
        <div className="flex items-center gap-2 bg-white/20 px-4 py-1.5 rounded-full text-xs md:text-sm">
          <Calendar className="w-4 h-4" />
          <span>최종 업데이트: {formattedDate}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] w-full px-4 md:px-8 xl:px-12 mx-auto mt-6 md:mt-8">
        {/* 클라이언트 컴포넌트(검색 및 렌더링)에 데이터 전달 */}
        <ArticleList initialArticles={articles || []} />
      </main>
    </div>
  );
}
