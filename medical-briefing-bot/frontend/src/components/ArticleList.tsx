'use client';

import { useState } from 'react';
import { ExternalLink, Search, Layers } from 'lucide-react';

interface Article {
  id: number;
  source: string;
  title: string;
  url: string;
  published_date: string;
  status: string;
  [key: string]: any;
}

export default function ArticleList({ initialArticles }: { initialArticles: Article[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<string | 'ALL'>('ALL');

  // 원본 데이터에서 고유한 출처(Source) 목록 추출
  const sources = Array.from(new Set(initialArticles.map(a => a.source))).sort();

  // 검색어 필터링 적용
  const filteredArticles = initialArticles.filter((article: Article) => 
    article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    article.source.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 출처별 그룹화
  const articlesBySource = filteredArticles.reduce((acc: Record<string, Article[]>, article: Article) => {
    if (!acc[article.source]) acc[article.source] = [];
    acc[article.source].push(article);
    return acc;
  }, {});

  // 현재 활성화된 탭에 맞춰 보여줄 데이터 선별
  const displayedSources = activeTab === 'ALL' 
    ? Object.entries(articlesBySource) 
    : Object.entries(articlesBySource).filter(([source]) => source === activeTab);

  return (
    <>
      {/* 검색 바 */}
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

      {/* 탭 네비게이션 */}
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

      {/* 게시물 목록 */}
      {displayedSources.map(([source, sourceArticles]) => (
        <section key={source} className="mb-10 bg-white p-4 md:p-8 rounded-xl shadow-sm border border-[#E8DCCB]/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <h2 className="text-lg md:text-xl font-bold text-[#5C2D0C] mb-6 flex items-center gap-2 border-b-2 border-[#C05A12] pb-3 pr-6 inline-block">
            <span className="text-[#C05A12]">■</span> {source}
          </h2>
          
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
                {sourceArticles.map((article) => {
                  const isNew = article.status === 'NEW';
                  return (
                    <tr key={article.id} className="hover:bg-[#F5EFE6] transition-colors group">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-bold ${
                          isNew ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {article.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <a 
                          href={article.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[#333333] hover:text-[#C05A12] flex items-center gap-1 group-hover:underline"
                        >
                          {article.title}
                          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-center">
                        {new Date(article.published_date).toISOString().split('T')[0]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
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
