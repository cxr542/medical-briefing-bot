'use client';

import { useState, useMemo } from 'react';
import { ExternalLink, Layers, Download, Printer, ChevronLeft, ChevronRight, Star, Megaphone, FileText } from 'lucide-react';

interface Article {
  id: number;
  source: string;
  title: string;
  url: string;
  published_date: string;
  status: string;
  is_merged?: boolean;
  related_links?: any[];
  [key: string]: any;
}

export default function ArticleList({ initialArticles }: { initialArticles: Article[] }) {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // 출처 분류 (전문지 vs 공공기관)
  const pressSources = ['메디게이트뉴스', '데일리메디', '메디컬타임즈', '청년의사'];
  
  const publicArticles = initialArticles.filter(a => !pressSources.includes(a.source));
  const pressArticles = initialArticles.filter(a => pressSources.includes(a.source));

  // 1. 7일 이내 주요 공지 (공공기관 최신순 정렬)
  const topNotices = [...publicArticles].sort((a, b) => new Date(b.published_date).getTime() - new Date(a.published_date).getTime());
  const totalPages = Math.ceil(topNotices.length / itemsPerPage);
  const currentNotices = topNotices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // 2. 기관별 공지사항 그룹화
  const publicSourcesMap = publicArticles.reduce((acc: Record<string, Article[]>, article) => {
    if (!acc[article.source]) acc[article.source] = [];
    acc[article.source].push(article);
    return acc;
  }, {});

  // 3. 의료전문지 최신기사 그룹화
  const pressSourcesMap = pressArticles.reduce((acc: Record<string, Article[]>, article) => {
    if (!acc[article.source]) acc[article.source] = [];
    acc[article.source].push(article);
    return acc;
  }, {});

  const handlePrint = () => window.print();

  const handleDownloadCsv = () => {
    let csvContent = "상태,출처,발행일,제목,URL\n";
    initialArticles.forEach(a => {
      const title = `"${a.title.replace(/"/g, '""')}"`;
      const date = new Date(a.published_date).toISOString().split('T')[0];
      csvContent += `${a.status},"${a.source}",${date},${title},"${a.url}"\n`;
    });
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `의료브리핑_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 개별 카드 렌더링 컴포넌트
  const SourceCard = ({ source, articles, isPress }: { source: string, articles: Article[], isPress?: boolean }) => {
    const borderColor = isPress ? 'border-gray-200 hover:border-[#8E6E53]' : 'border-[#E8DCCB] hover:border-[#C05A12]';
    const headerColor = isPress ? 'text-[#5C2D0C] bg-gray-50' : 'text-[#C05A12] bg-[#FDFBF7]';
    
    return (
      <div className={`bg-white rounded-xl shadow-sm border ${borderColor} flex flex-col h-full overflow-hidden transition-all duration-300`}>
        <div className={`px-4 py-3 border-b ${borderColor} ${headerColor} font-bold text-lg flex items-center gap-2`}>
          {isPress ? <FileText className="w-5 h-5 opacity-70" /> : <Megaphone className="w-5 h-5 opacity-70" />}
          {source}
        </div>
        <div className="p-4 flex-grow">
          <ul className="space-y-4">
            {articles.slice(0, 4).map(article => (
              <li key={article.id} className="group">
                <a href={article.url} target="_blank" rel="noopener noreferrer" className="block">
                  <div className="text-sm font-medium text-gray-800 group-hover:text-[#C05A12] group-hover:underline line-clamp-2 leading-snug">
                    <span className="text-xs text-[#C05A12] mr-1.5">•</span>
                    {article.title}
                  </div>
                  <div className="text-xs text-gray-400 mt-1.5 ml-3">
                    {new Date(article.published_date).toISOString().split('T')[0]}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
        {articles.length > 4 && (
          <div className="p-3 border-t border-gray-100 text-center bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-[#5C2D0C] cursor-pointer text-sm font-medium transition-colors">
            더보기 →
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* 액션 버튼 */}
      <div className="flex justify-end gap-2 print:hidden mb-2">
        <button onClick={handleDownloadCsv} className="flex items-center gap-1.5 bg-white border border-[#E8DCCB] text-[#5C2D0C] text-sm font-semibold py-1.5 px-3 rounded-lg hover:bg-[#F5EFE6] shadow-sm transition-colors">
          <Download className="w-4 h-4" /> 엑셀 다운로드
        </button>
        <button onClick={handlePrint} className="flex items-center gap-1.5 bg-[#5C2D0C] border border-[#5C2D0C] text-white text-sm font-semibold py-1.5 px-3 rounded-lg hover:bg-[#8E6E53] shadow-sm transition-colors">
          <Printer className="w-4 h-4" /> 리포트 인쇄
        </button>
      </div>

      {/* 1. 7일 이내 주요 공지 */}
      <section className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] overflow-hidden print:shadow-none print:border-none">
        <div className="px-5 py-4 border-b border-[#E8DCCB] flex justify-between items-center bg-[#FDFBF7]">
          <h2 className="text-xl font-bold text-[#5C2D0C] flex items-center gap-2">
            <Star className="w-6 h-6 text-[#C05A12] fill-[#C05A12]" /> 
            주요 공지 및 최신 법령
            <span className="bg-[#C05A12] text-white text-xs px-2.5 py-0.5 rounded-full ml-2">전체 {topNotices.length}건</span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-5 py-3 font-semibold w-32">상태</th>
                <th className="px-5 py-3 font-semibold w-40">기관</th>
                <th className="px-5 py-3 font-semibold">제목 (클릭 시 원문 이동)</th>
                <th className="px-5 py-3 font-semibold w-28 text-center">날짜</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {currentNotices.map((article) => {
                const isDeleted = article.status === 'DELETED';
                return (
                  <tr key={article.id} className={`hover:bg-[#F5EFE6]/50 transition-colors ${isDeleted ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3 align-top">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ${
                        article.status === 'NEW' ? 'bg-red-50 text-red-600 border border-red-200' : 
                        article.status === 'UPDATE' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' :
                        article.status === 'DELETED' ? 'bg-gray-100 text-gray-600 border border-gray-200 line-through' :
                        'bg-gray-50 text-gray-600 border border-gray-200'
                      }`}>
                        {article.status}
                      </span>
                      {article.is_merged && (
                        <span className="block mt-1 text-[10px] text-[#C05A12] font-semibold">↳ AI 통합됨</span>
                      )}
                    </td>
                    <td className="px-5 py-3 align-top font-medium text-gray-700">{article.source}</td>
                    <td className="px-5 py-3 align-top">
                      <a href={article.url} target="_blank" rel="noopener noreferrer" className={`text-gray-900 hover:text-[#C05A12] font-medium flex items-center gap-1 group ${isDeleted ? 'line-through' : ''}`}>
                        {article.title}
                        <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-[#C05A12]" />
                      </a>
                      {article.is_merged && article.related_links && article.related_links.length > 0 && (
                        <div className="mt-2 pl-2 border-l-2 border-[#E8DCCB]">
                          <ul className="space-y-1">
                            {article.related_links.map((link: any, idx: number) => (
                              <li key={idx}>
                                <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-[#C05A12]">
                                  <span className="font-semibold mr-1">[{link.source}]</span>{link.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 align-top text-gray-500 text-center text-xs">
                      {new Date(article.published_date).toISOString().split('T')[0]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1 py-4 border-t border-gray-100 bg-gray-50 print:hidden">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1 rounded text-gray-500 hover:text-[#5C2D0C] disabled:opacity-30">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-gray-600 px-3">{currentPage} / {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-1 rounded text-gray-500 hover:text-[#5C2D0C] disabled:opacity-30">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </section>

      {/* 2. 기관별 공지사항 */}
      <section className="print:break-before-page">
        <h2 className="text-xl font-bold text-[#5C2D0C] flex items-center gap-2 mb-4 border-b-2 border-[#C05A12] pb-2">
          <Megaphone className="w-6 h-6 text-[#C05A12]" /> 
          기관별 공지사항
          <span className="text-sm font-normal text-gray-500 ml-2">각 기관의 최신 공지사항을 확인하세요.</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(publicSourcesMap).map(([source, articles]) => (
            <SourceCard key={source} source={source} articles={articles} />
          ))}
        </div>
      </section>

      {/* 3. 의료전문지 최신기사 */}
      <section className="print:break-before-page">
        <h2 className="text-xl font-bold text-[#5C2D0C] flex items-center gap-2 mb-4 border-b-2 border-[#8E6E53] pb-2">
          <FileText className="w-6 h-6 text-[#8E6E53]" /> 
          의료전문지 최신기사
          <span className="text-sm font-normal text-gray-500 ml-2">의료계 주요 뉴스를 확인하세요.</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(pressSourcesMap).map(([source, articles]) => (
            <SourceCard key={source} source={source} articles={articles} isPress={true} />
          ))}
        </div>
      </section>

    </div>
  );
}
