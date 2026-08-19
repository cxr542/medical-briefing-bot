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

  const allSources = useMemo(() => Array.from(new Set(initialArticles.map(a => a.source))).sort(), [initialArticles]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [showStatusTooltip, setShowStatusTooltip] = useState(false);
  
  // 최초 로드 시 '국가법령정보센터'를 제외하고 전체 선택
  useMemo(() => {
    if (selectedSources.length === 0 && allSources.length > 0) {
      setSelectedSources(allSources.filter(s => s !== '국가법령정보센터'));
    }
  }, [allSources]);

  // 출처 필터링 적용
  const filteredInitialArticles = initialArticles.filter(a => selectedSources.includes(a.source));

  // 출처 분류 (전문지 vs 공공기관)
  const pressSources = ['메디게이트뉴스', '데일리메디', '메디컬타임즈', '청년의사'];
  
  const publicArticles = filteredInitialArticles.filter(a => !pressSources.includes(a.source));
  const pressArticles = filteredInitialArticles.filter(a => pressSources.includes(a.source));

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
    filteredInitialArticles.forEach(a => {
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

  const handleSourceToggle = (source: string) => {
    setSelectedSources(prev => 
      prev.includes(source) ? prev.filter(s => s !== source) : [...prev, source]
    );
    setCurrentPage(1); // 필터 변경 시 첫 페이지로 리셋
  };

  const handleAllToggle = () => {
    if (selectedSources.length === allSources.length) {
      setSelectedSources([]); // 전체 해제
    } else {
      setSelectedSources(allSources); // 전체 선택
    }
    setCurrentPage(1);
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
            더보기 ({articles.length - 4}건) →
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* 상단 컨트롤 패널 (필터 및 액션) */}
      <div className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] p-4 print:hidden flex flex-col gap-4">
        <div className="flex justify-between items-center border-b border-gray-100 pb-3">
          <h3 className="font-bold text-[#5C2D0C] flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#C05A12]" /> 수집 출처 필터링
          </h3>
          <div className="flex gap-2">
            <button onClick={handleDownloadCsv} className="flex items-center gap-1.5 bg-white border border-[#E8DCCB] text-[#5C2D0C] text-sm font-semibold py-1.5 px-3 rounded-lg hover:bg-[#F5EFE6] shadow-sm transition-colors">
              <Download className="w-4 h-4" /> 엑셀 다운로드
            </button>
            <button onClick={handlePrint} className="flex items-center gap-1.5 bg-[#5C2D0C] border border-[#5C2D0C] text-white text-sm font-semibold py-1.5 px-3 rounded-lg hover:bg-[#8E6E53] shadow-sm transition-colors">
              <Printer className="w-4 h-4" /> 리포트 인쇄
            </button>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2 items-center">
          <button 
            onClick={handleAllToggle}
            className={`px-3 py-1.5 rounded-full text-sm font-bold border transition-colors shadow-sm ${selectedSources.length === allSources.length && allSources.length > 0 ? 'bg-[#5C2D0C] text-white border-[#5C2D0C]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            전체 선택
          </button>
          <div className="w-px h-5 bg-gray-300 mx-1"></div>
          {allSources.map(source => (
            <button
              key={source}
              onClick={() => handleSourceToggle(source)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors shadow-sm ${selectedSources.includes(source) ? 'bg-[#C05A12] text-white border-[#C05A12]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
            >
              {source}
            </button>
          ))}
        </div>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div className="space-y-8">
        
        {filteredInitialArticles.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-[#E8DCCB]/50 print:hidden">
            <p className="text-lg text-gray-500">
              선택된 출처가 없습니다. 상단 메뉴에서 출처를 선택해주세요.
            </p>
          </div>
        ) : (
          <>
            {/* 1. 7일 이내 주요 공지 */}
            {topNotices.length > 0 && (
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
                        <th className="px-5 py-3 font-semibold w-28 relative">
                          <div 
                            className="flex items-center gap-1 cursor-help"
                            onMouseEnter={() => setShowStatusTooltip(true)}
                            onMouseLeave={() => setShowStatusTooltip(false)}
                          >
                            상태
                            <div className="w-4 h-4 rounded-full border border-gray-400 text-gray-500 flex items-center justify-center text-[10px]">?</div>
                          </div>
                          
                          {/* 상태 툴팁 */}
                          {showStatusTooltip && (
                            <div className="absolute top-10 left-4 z-50 w-64 p-3 bg-white border border-gray-200 shadow-lg rounded-lg text-xs font-normal text-gray-700 animate-in fade-in zoom-in-95">
                              <p className="font-bold text-[#5C2D0C] mb-2 border-b pb-1">데이터 상태 안내</p>
                              <ul className="space-y-1.5">
                                <li><span className="inline-block w-12 font-bold text-red-600">NEW</span>: 오늘 새로 수집된 기사</li>
                                <li><span className="inline-block w-12 font-bold text-yellow-600">UPDATE</span>: 내용이 수정되거나 통합된 기사</li>
                                <li><span className="inline-block w-12 font-bold text-gray-500 line-through">DELETED</span>: 원본 사이트에서 삭제된 기사</li>
                                <li><span className="inline-block w-12 font-bold text-gray-600">유지</span>: 내용 변경 없이 어제와 동일한 기사</li>
                              </ul>
                            </div>
                          )}
                        </th>
                        <th className="px-5 py-3 font-semibold w-28 text-center">날짜</th>
                        <th className="px-5 py-3 font-semibold w-56">기관</th>
                        <th className="px-5 py-3 font-semibold min-w-[200px]">제목</th>
                        <th className="px-5 py-3 font-semibold w-32 text-center">구분</th>
                        <th className="px-5 py-3 font-semibold w-48">주요 키워드</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {currentNotices.map((article) => {
                        const isDeleted = article.status === 'DELETED';
                        
                        // 임시 데이터 로직 (DB에 구분/키워드 컬럼이 아직 없으므로, 제목 기반으로 간단히 분류)
                        let mockCategory = "일반";
                        let mockCatColor = "bg-gray-100 text-gray-600";
                        if (article.title.includes('평가')) { mockCategory = "평가"; mockCatColor = "bg-purple-100 text-purple-700"; }
                        else if (article.title.includes('심사') || article.title.includes('기준')) { mockCategory = "심사기준"; mockCatColor = "bg-green-100 text-green-700"; }
                        else if (article.title.includes('시스템') || article.title.includes('점검')) { mockCategory = "시스템"; mockCatColor = "bg-orange-100 text-orange-700"; }
                        else if (article.title.includes('제도') || article.title.includes('수가') || article.title.includes('정책')) { mockCategory = "정책/제도"; mockCatColor = "bg-blue-100 text-blue-700"; }
                        else if (article.title.includes('교육') || article.title.includes('설명회')) { mockCategory = "행사/교육"; mockCatColor = "bg-teal-100 text-teal-700"; }
                        
                        let mockKeywords = "분석 대기중...";
                        if (article.title.includes('수가')) mockKeywords = "수가, 건강보험, 인상";
                        else if (article.title.includes('심사')) mockKeywords = "심사기준, 청구, 유의사항";
                        else if (article.title.includes('시스템')) mockKeywords = "청구, 시스템, 점검";
                        else if (article.title.includes('평가')) mockKeywords = "적정성평가, 지표, 변경";
                        else if (article.title.includes('설명회')) mockKeywords = "경영지원, 정책설명회, 중소병원";

                        return (
                          <tr key={article.id} className={`hover:bg-[#F5EFE6]/50 transition-colors ${isDeleted ? 'opacity-50' : ''}`}>
                            <td className="px-5 py-3 align-middle">
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
                            <td className="px-5 py-3 align-middle text-gray-500 text-center text-xs">
                              {new Date(article.published_date).toISOString().split('T')[0]}
                            </td>
                            <td className="px-5 py-3 align-middle font-medium text-gray-700">{article.source}</td>
                            <td className="px-5 py-3 align-middle">
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
                            <td className="px-5 py-3 align-middle text-center">
                              <span className={`inline-flex px-2 py-1 rounded text-xs font-semibold ${mockCatColor}`}>
                                {article.category || mockCategory}
                              </span>
                            </td>
                            <td className="px-5 py-3 align-middle text-xs text-gray-600">
                              {article.keywords || mockKeywords}
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
            )}

            {/* 2. 기관별 공지사항 */}
            {Object.keys(publicSourcesMap).length > 0 && (
              <section className="print:break-before-page">
                <h2 className="text-xl font-bold text-[#5C2D0C] flex items-center gap-2 mb-4 border-b-2 border-[#C05A12] pb-2">
                  <Megaphone className="w-6 h-6 text-[#C05A12]" /> 
                  기관별 공지사항
                  <span className="text-sm font-normal text-gray-500 ml-2">각 기관의 최신 공지사항을 확인하세요.</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {Object.entries(publicSourcesMap).map(([source, articles]) => (
                    <SourceCard key={source} source={source} articles={articles} />
                  ))}
                </div>
              </section>
            )}

            {/* 3. 의료전문지 최신기사 */}
            {Object.keys(pressSourcesMap).length > 0 && (
              <section className="print:break-before-page">
                <h2 className="text-xl font-bold text-[#5C2D0C] flex items-center gap-2 mb-4 border-b-2 border-[#8E6E53] pb-2">
                  <FileText className="w-6 h-6 text-[#8E6E53]" /> 
                  의료전문지 최신기사
                  <span className="text-sm font-normal text-gray-500 ml-2">의료계 주요 뉴스를 확인하세요.</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {Object.entries(pressSourcesMap).map(([source, articles]) => (
                    <SourceCard key={source} source={source} articles={articles} isPress={true} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
