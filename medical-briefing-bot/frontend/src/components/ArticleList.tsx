'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, Search, Layers, ChevronLeft, ChevronRight } from 'lucide-react';

interface Article {
  id: number;
  source: string;
  title: string;
  url: string;
  published_date: string;
  status: string;
  [key: string]: any;
}

// 각 출처별 테이블을 렌더링하고 페이지네이션을 관리하는 컴포넌트
function SourceTable({ source, articles }: { source: string; articles: Article[] }) {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const totalPages = Math.ceil(articles.length / itemsPerPage);

  // 검색어나 탭이 바뀌어서 articles가 변하면 첫 페이지로 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [articles]);

  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentArticles = articles.slice(startIndex, startIndex + itemsPerPage);

  return (
    <section className="mb-10 bg-white p-4 md:p-8 rounded-xl shadow-sm border border-[#E8DCCB]/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex justify-between items-center mb-6 border-b-2 border-[#C05A12] pb-3">
        <h2 className="text-lg md:text-xl font-bold text-[#5C2D0C] flex items-center gap-2">
          <span className="text-[#C05A12]">■</span> {source}
        </h2>
        <span className="text-sm text-gray-500 font-medium">총 {articles.length}건</span>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left min-w-[600px]">
          <thead className="bg-[#C05A12] text-white">
            <tr>
              <th className="px-4 py-3 rounded-tl-md font-semibold w-24">상태</th>
              <th className="px-4 py-3 font-semibold">제목 (클릭 시 원문 이동)</th>
              <th className="px-4 py-3 rounded-tr-md font-semibold w-32 text-center">발행일자</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8DCCB]">
            {currentArticles.map((article) => {
              const isNew = article.status === 'NEW';
              return (
                    <tr key={article.id} className="hover:bg-[#F5EFE6] transition-colors group">
                      <td className="px-4 py-3 align-top">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-bold ${
                          isNew ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {article.status}
                        </span>
                        {article.is_merged && (
                          <span className="block mt-1 text-[10px] text-[#C05A12] font-semibold border border-[#C05A12] rounded px-1 text-center bg-orange-50">
                            통합됨
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium align-top">
                        <a 
                          href={article.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[#333333] hover:text-[#C05A12] flex items-center gap-1 group-hover:underline text-base"
                        >
                          {article.title}
                          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>
                        
                        {/* 관련 기사 (AI가 묶어준 중복 기사들) */}
                        {article.is_merged && article.related_links && article.related_links.length > 0 && (
                          <div className="mt-3 pl-3 border-l-2 border-[#E8DCCB]">
                            <p className="text-xs font-bold text-gray-500 mb-1 flex items-center gap-1">
                              <Layers className="w-3 h-3" /> 연관 보도 ({article.related_links.length}건)
                            </p>
                            <ul className="space-y-1">
                              {article.related_links.map((link: any, idx: number) => (
                                <li key={idx}>
                                  <a 
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-gray-600 hover:text-[#C05A12] hover:underline flex items-center gap-1.5"
                                  >
                                    <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 border border-gray-200">
                                      {link.source}
                                    </span>
                                    <span className="truncate max-w-[300px] md:max-w-[500px]">{link.title}</span>
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-center align-top">
                        {new Date(article.published_date).toISOString().split('T')[0]}
                      </td>
                    </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 컨트롤 */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-6">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-[#5C2D0C]" />
          </button>
          
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`w-8 h-8 rounded text-sm font-medium transition-colors ${
                  currentPage === page
                    ? 'bg-[#5C2D0C] text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {page}
              </button>
            ))}
          </div>

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-[#5C2D0C]" />
          </button>
        </div>
      )}
    </section>
  );
}

export default function ArticleList({ initialArticles }: { initialArticles: Article[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<string | 'ALL'>('ALL');

  const sources = Array.from(new Set(initialArticles.map(a => a.source))).sort();

  const filteredArticles = initialArticles.filter((article: Article) => 
    article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    article.source.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const articlesBySource = filteredArticles.reduce((acc: Record<string, Article[]>, article: Article) => {
    if (!acc[article.source]) acc[article.source] = [];
    acc[article.source].push(article);
    return acc;
  }, {});

  const displayedSources = activeTab === 'ALL' 
    ? Object.entries(articlesBySource) 
    : Object.entries(articlesBySource).filter(([source]) => source === activeTab);

  return (
    <>
      <div className="mb-6 relative max-w-2xl mx-auto md:mx-0">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          placeholder="기사 제목이나 출처(예: 심평원)를 검색해보세요..."
          className="block w-full pl-11 pr-4 py-3 border border-[#E8DCCB] rounded-xl leading-5 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C05A12] focus:border-[#C05A12] transition-colors shadow-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="mb-8 flex flex-wrap gap-2 border-b-2 border-[#E8DCCB] pb-2">
        <button
          onClick={() => setActiveTab('ALL')}
          className={`px-5 py-2.5 rounded-t-lg font-bold transition-colors flex items-center gap-2 ${
            activeTab === 'ALL' 
              ? 'bg-[#5C2D0C] text-white shadow-md' 
              : 'bg-white text-gray-500 hover:bg-[#F5EFE6] border border-b-0 border-[#E8DCCB]'
          }`}
        >
          <Layers className="w-4 h-4" /> 전체 보기
        </button>
        {sources.map(source => (
          <button
            key={source}
            onClick={() => setActiveTab(source)}
            className={`px-5 py-2.5 rounded-t-lg font-bold transition-colors ${
              activeTab === source 
                ? 'bg-[#C05A12] text-white shadow-md' 
                : 'bg-white text-gray-500 hover:bg-[#F5EFE6] border border-b-0 border-[#E8DCCB]'
            }`}
          >
            {source}
          </button>
        ))}
      </div>

      {displayedSources.map(([source, sourceArticles]) => (
        <SourceTable key={source} source={source} articles={sourceArticles} />
      ))}

      {displayedSources.length === 0 && (
        <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-[#E8DCCB]/50">
          <p className="text-lg text-gray-500">
            {searchTerm ? `'${searchTerm}'에 대한 검색 결과가 없습니다.` : '해당 탭에 수집된 데이터가 없습니다.'}
          </p>
        </div>
      )}
    </>
  );
}
