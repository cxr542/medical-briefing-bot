'use client';

import { useState, useMemo } from 'react';
import { ExternalLink, Layers, Download, Printer, ChevronLeft, ChevronRight, Star, Megaphone, FileText, Building2, Calendar, X, Home } from 'lucide-react';

interface RelatedLink {
  title: string;
  url: string;
  source: string;
}

interface Article {
  id: number;
  source: string;
  title: string;
  url: string;
  published_date: string;
  status: string;
  category?: string;
  keywords?: string;
  is_merged?: boolean;
  related_links?: RelatedLink[];
}

interface BriefingAnalysis {
  category: string;
  categoryClassName: string;
  keywords: string;
}

const PRESS_SOURCES: readonly string[] = ['메디게이트뉴스', '데일리메디', '메디컬타임즈', '청년의사', '의협신문'];

export default function ArticleList({ initialArticles }: { initialArticles: Article[] }) {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // 가장 최근 수집 시간 계산 (06, 09, 12, 15)
  const getLatestScheduleTime = () => {
    const kstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const h = kstDate.getHours();
    if (h < 6) return '15:00'; // 어제 15시
    if (h < 9) return '06:00';
    if (h < 12) return '09:00';
    if (h < 15) return '12:00';
    return '15:00';
  };

  // 달력(날짜 선택) 상태 관리 (기본값: 오늘 KST, 6시 이전이면 어제)
  const [selectedDate, setSelectedDate] = useState(() => {
    const kstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    if (kstDate.getHours() < 6) kstDate.setDate(kstDate.getDate() - 1);
    return `${kstDate.getFullYear()}-${String(kstDate.getMonth() + 1).padStart(2, '0')}-${String(kstDate.getDate()).padStart(2, '0')}`;
  });

  const [selectedTime, setSelectedTime] = useState(getLatestScheduleTime());

  const handlePrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };

  const handleNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };

  const handleToday = () => {
    const kstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    if (kstDate.getHours() < 6) kstDate.setDate(kstDate.getDate() - 1);
    setSelectedDate(`${kstDate.getFullYear()}-${String(kstDate.getMonth() + 1).padStart(2, '0')}-${String(kstDate.getDate()).padStart(2, '0')}`);
    setSelectedTime(getLatestScheduleTime());
  };

  // 선택된 날짜와 시간의 59분 59초까지 수집된 기사만 필터링 (타임머신 기능)
  const timeFilteredArticles = useMemo(() => {
    const [hh] = selectedTime.split(':');
    const targetEndKst = new Date(`${selectedDate}T${hh}:59:59+09:00`);
    return initialArticles.filter(a => new Date(a.published_date) <= targetEndKst);
  }, [initialArticles, selectedDate, selectedTime]);

  const allSources = useMemo(() => Array.from(new Set(initialArticles.map(a => a.source))).sort(), [initialArticles]);
  const [selectedSources, setSelectedSources] = useState<string[]>(() => allSources.filter(s => s !== '국가법령정보센터'));
  const [showStatusTooltip, setShowStatusTooltip] = useState(false);
  
  // 출처 필터링 적용 (timeFilteredArticles 기반)
  const filteredInitialArticles = useMemo(
    () => timeFilteredArticles.filter(a => selectedSources.includes(a.source)),
    [timeFilteredArticles, selectedSources],
  );

  // 출처 분류 (전문지 vs 공공기관)
  const publicArticles = useMemo(
    () => filteredInitialArticles.filter(a => !PRESS_SOURCES.includes(a.source)),
    [filteredInitialArticles],
  );
  const pressArticles = useMemo(
    () => filteredInitialArticles.filter(a => PRESS_SOURCES.includes(a.source)),
    [filteredInitialArticles],
  );

  // 1. 7일 이내 주요 공지 (선택한 날짜 기준 7일 필터링)
  const recentNotices = useMemo(() => {
    const targetEndKst = new Date(`${selectedDate}T23:59:59+09:00`);
    const sevenDaysAgo = new Date(targetEndKst);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    return publicArticles.filter(a => new Date(a.published_date) >= sevenDaysAgo);
  }, [publicArticles, selectedDate]);
  
  const topNotices = [...recentNotices].sort((a, b) => new Date(b.published_date).getTime() - new Date(a.published_date).getTime());
  
  const totalPages = Math.ceil(topNotices.length / itemsPerPage);
  const currentNotices = topNotices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // 모달 상태 관리
  const [modalSource, setModalSource] = useState<string | null>(null);
  const [modalPage, setModalPage] = useState(1);
  const modalItemsPerPage = 10;
  
  const modalArticles = useMemo(() => {
    if (!modalSource) return [];
    // 모달에서는 타임머신 필터링(timeFilteredArticles)은 유지하되, 해당 출처의 모든 기사 표시
    return timeFilteredArticles
      .filter(a => a.source === modalSource)
      .sort((a, b) => new Date(b.published_date).getTime() - new Date(a.published_date).getTime());
  }, [modalSource, timeFilteredArticles]);
  
  const modalTotalPages = Math.ceil(modalArticles.length / modalItemsPerPage);
  const currentModalArticles = modalArticles.slice((modalPage - 1) * modalItemsPerPage, modalPage * modalItemsPerPage);

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
      setSelectedSources(allSources.filter(s => s !== '국가법령정보센터')); // 전체 선택
    }
    setCurrentPage(1);
  };

  // 개별 카드 렌더링 컴포넌트
  const SourceCard = ({ source, articles, isPress }: { source: string, articles: Article[], isPress?: boolean }) => {
    let theme = { border: 'border-gray-200', text: 'text-gray-700', bullet: 'text-gray-400', buttonBorder: 'border-gray-200', buttonHover: 'hover:bg-gray-50 hover:text-gray-700', groupHoverText: 'group-hover:text-gray-700' };
    
    if (source.includes('복지부')) theme = { border: 'border-green-300', text: 'text-green-700', bullet: 'text-green-600', buttonBorder: 'border-green-200', buttonHover: 'hover:bg-green-50 hover:text-green-700', groupHoverText: 'group-hover:text-green-700' };
    else if (source.includes('요양기관')) theme = { border: 'border-blue-300', text: 'text-blue-600', bullet: 'text-blue-500', buttonBorder: 'border-blue-200', buttonHover: 'hover:bg-blue-50 hover:text-blue-600', groupHoverText: 'group-hover:text-blue-600' };
    else if (source.includes('건보공단') || source.includes('건강보험')) theme = { border: 'border-orange-300', text: 'text-orange-500', bullet: 'text-orange-400', buttonBorder: 'border-orange-200', buttonHover: 'hover:bg-orange-50 hover:text-orange-500', groupHoverText: 'group-hover:text-orange-500' };
    else if (source.includes('병협') || source.includes('병원협회')) theme = { border: 'border-purple-300', text: 'text-purple-600', bullet: 'text-purple-500', buttonBorder: 'border-purple-200', buttonHover: 'hover:bg-purple-50 hover:text-purple-600', groupHoverText: 'group-hover:text-purple-600' };
    else if (source.includes('평가')) theme = { border: 'border-teal-300', text: 'text-teal-600', bullet: 'text-teal-500', buttonBorder: 'border-teal-200', buttonHover: 'hover:bg-teal-50 hover:text-teal-600', groupHoverText: 'group-hover:text-teal-600' };
    else if (source.includes('심사')) theme = { border: 'border-indigo-300', text: 'text-indigo-500', bullet: 'text-indigo-400', buttonBorder: 'border-indigo-200', buttonHover: 'hover:bg-indigo-50 hover:text-indigo-500', groupHoverText: 'group-hover:text-indigo-500' };
    else if (source.includes('메디칼타임즈')) theme = { border: 'border-red-300', text: 'text-red-500', bullet: 'text-red-400', buttonBorder: 'border-red-200', buttonHover: 'hover:bg-red-50 hover:text-red-500', groupHoverText: 'group-hover:text-red-500' };
    else if (source.includes('청년의사')) theme = { border: 'border-sky-300', text: 'text-sky-500', bullet: 'text-sky-400', buttonBorder: 'border-sky-200', buttonHover: 'hover:bg-sky-50 hover:text-sky-500', groupHoverText: 'group-hover:text-sky-500' };
    else if (source.includes('의협신문')) theme = { border: 'border-pink-300', text: 'text-pink-500', bullet: 'text-pink-400', buttonBorder: 'border-pink-200', buttonHover: 'hover:bg-pink-50 hover:text-pink-500', groupHoverText: 'group-hover:text-pink-500' };
    else if (source.includes('메디게이트뉴스')) theme = { border: 'border-emerald-300', text: 'text-emerald-600', bullet: 'text-emerald-500', buttonBorder: 'border-emerald-200', buttonHover: 'hover:bg-emerald-50 hover:text-emerald-600', groupHoverText: 'group-hover:text-emerald-600' };
    else if (source.includes('데일리메디')) theme = { border: 'border-blue-300', text: 'text-blue-600', bullet: 'text-blue-500', buttonBorder: 'border-blue-200', buttonHover: 'hover:bg-blue-50 hover:text-blue-600', groupHoverText: 'group-hover:text-blue-600' };
    else if (source.includes('국가법령')) theme = { border: 'border-slate-300', text: 'text-slate-600', bullet: 'text-slate-500', buttonBorder: 'border-slate-200', buttonHover: 'hover:bg-slate-50 hover:text-slate-600', groupHoverText: 'group-hover:text-slate-600' };

    return (
      <div className={`bg-white rounded-xl shadow-sm border ${theme.border} flex flex-col h-full overflow-hidden transition-all duration-300 hover:shadow-md`}>
        <div className={`px-4 pt-5 pb-2 font-bold text-lg flex items-center gap-2 ${theme.text}`}>
          {isPress ? <FileText className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
          {source}
        </div>
        <div className="px-4 pb-4 flex-grow">
          <ul className="space-y-4">
            {articles.slice(0, 3).map(article => (
              <li key={article.id} className="group">
                <a href={article.url} target="_blank" rel="noopener noreferrer" className="block" title={article.title}>
                  <div className={`text-sm font-medium text-gray-700 group-hover:underline truncate ${theme.groupHoverText}`}>
                    <span className={`text-sm mr-1.5 ${theme.bullet}`}>•</span>
                    {article.title}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1 ml-3 font-medium">
                    {new Date(article.published_date).toISOString().split('T')[0]}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-4 pb-4">
          <button 
            onClick={() => {
              setModalSource(source);
              setModalPage(1);
            }}
            className={`w-full py-2 rounded-lg border text-sm font-bold transition-colors ${theme.buttonBorder} ${theme.text} ${theme.buttonHover}`}
          >
            더보기 →
          </button>
        </div>
      </div>
    );
  };

  // 기관별 누적 수집 건수 계산
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    initialArticles.forEach(a => {
      counts[a.source] = (counts[a.source] || 0) + 1;
    });
    return counts;
  }, [initialArticles]);

  const analyzeArticle = (article: Article): BriefingAnalysis => {
    // AI가 추출한 진짜 카테고리와 키워드가 DB에 있다면 우선 사용
    if (article.category || article.keywords) {
      let categoryClassName = "bg-gray-100 text-gray-700";
      const cat = article.category || "일반공지";
      if (cat.includes('평가')) categoryClassName = "bg-purple-100 text-purple-700";
      else if (cat.includes('심사') || cat.includes('수가') || cat.includes('급여')) categoryClassName = "bg-teal-100 text-teal-700";
      else if (cat.includes('보도') || cat.includes('뉴스') || cat.includes('기사')) categoryClassName = "bg-blue-100 text-blue-700";
      else if (cat.includes('법령') || cat.includes('입법')) categoryClassName = "bg-rose-100 text-rose-700";
      
      return {
        category: cat,
        categoryClassName,
        keywords: article.keywords || ""
      };
    }

    const text = `${article.source} ${article.title}`;
    const matchedKeywords = [
      ['의료질평가', ['의료질평가', '지표', '정정신청']],
      ['적정성평가', ['적정성평가', '평가지표', '요양기관']],
      ['평가', ['평가', '지표', '결과']],
      ['수가', ['수가', '건강보험', '급여']],
      ['급여', ['급여기준', '청구', '건강보험']],
      ['심사', ['심사기준', '청구', '심평원']],
      ['개인정보', ['개인정보', '제3자 제공', '공개내역']],
      ['자동이체', ['보험료', '자동이체', '납부']],
      ['검진', ['검진기관', '장비현황', '건강검진']],
      ['공모', ['공모', '신청', '마감']],
      ['교육', ['교육', '안내', '참여']],
      ['설명회', ['설명회', '정책안내', '참여']],
      ['시스템', ['시스템', '점검', '업무중단']],
      ['법률', ['법령', '개정', '시행']],
      ['법령', ['법령', '개정', '시행']],
      ['의료법', ['의료법', '개정', '의료기관']],
      ['연명의료', ['연명의료', '계획서', '입법']],
      ['환자안전', ['환자안전', '자율규제', '의료계']],
      ['의료기사', ['의료기사법', '원격지도', '쟁점']],
      ['당뇨병', ['당뇨병', 'CGM', '급여확대']],
      ['보직', ['기관인사', '임원', '공백']],
      ['임명', ['기관인사', '임명', '보직']],
    ] as const;

    const keywordSet = new Set<string>();
    matchedKeywords.forEach(([needle, keywords]) => {
      if (text.includes(needle)) {
        keywords.forEach(keyword => keywordSet.add(keyword));
      }
    });

    if (keywordSet.size === 0) {
      if (article.source.includes('국가법령')) {
        ['법령', '보건의료', '제도'].forEach(keyword => keywordSet.add(keyword));
      } else if (PRESS_SOURCES.includes(article.source)) {
        ['의료계', '정책동향', '뉴스'].forEach(keyword => keywordSet.add(keyword));
      } else {
        ['공지', '기관안내', '확인필요'].forEach(keyword => keywordSet.add(keyword));
      }
    }

    let category = '일반공지';
    let categoryClassName = 'text-gray-600 border-gray-200 bg-gray-50';
    if (text.includes('평가') || text.includes('지표')) {
      category = '평가';
      categoryClassName = 'text-purple-600 border-purple-200 bg-purple-50';
    } else if (text.includes('심사') || text.includes('급여') || text.includes('수가') || text.includes('청구')) {
      category = '심사/수가';
      categoryClassName = 'text-green-600 border-green-200 bg-green-50';
    } else if (text.includes('시스템') || text.includes('점검') || text.includes('자동이체')) {
      category = '업무안내';
      categoryClassName = 'text-orange-600 border-orange-200 bg-orange-50';
    } else if (text.includes('법') || text.includes('법령') || text.includes('개정') || text.includes('시행')) {
      category = '법령/제도';
      categoryClassName = 'text-blue-600 border-blue-200 bg-blue-50';
    } else if (text.includes('교육') || text.includes('설명회') || text.includes('공모')) {
      category = '행사/신청';
      categoryClassName = 'text-teal-600 border-teal-200 bg-teal-50';
    } else if (text.includes('인사') || text.includes('임명') || text.includes('보직')) {
      category = '인사/조직';
      categoryClassName = 'text-slate-600 border-slate-200 bg-slate-50';
    }

    return {
      category: article.category || category,
      categoryClassName,
      keywords: article.keywords || Array.from(keywordSet).slice(0, 3).join(', '),
    };
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* 날짜 선택 패널 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] p-4 print:hidden flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-[#C05A12]" />
          <h3 className="font-bold text-[#5C2D0C]">브리핑 날짜</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePrevDay} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" title="이전 날짜">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-700 outline-none focus:border-[#C05A12] focus:ring-1 focus:ring-[#C05A12] cursor-pointer"
          />
          <select 
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-700 outline-none focus:border-[#C05A12] focus:ring-1 focus:ring-[#C05A12] cursor-pointer"
          >
            <option value="06:00">오전 06:00</option>
            <option value="09:00">오전 09:00</option>
            <option value="12:00">오후 12:00</option>
            <option value="15:00">오후 03:00</option>
          </select>
          <button onClick={handleNextDay} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" title="다음 날짜">
            <ChevronRight className="w-5 h-5" />
          </button>
          <button onClick={handleToday} className="ml-2 px-3 py-1.5 bg-[#F5EFE6] hover:bg-[#E8DCCB] text-[#5C2D0C] text-sm font-bold rounded-lg transition-colors shadow-sm">
            오늘
          </button>
        </div>
      </div>

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
            className={`px-3 py-1.5 rounded-full text-sm font-bold border transition-colors shadow-sm ${selectedSources.length === allSources.length - 1 && allSources.length > 0 ? 'bg-[#5C2D0C] text-white border-[#5C2D0C]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            기본 선택
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

      {/* 0. 기관별 수집 건수 요약 대시보드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 print:hidden">
        {allSources.map(source => {
          const count = sourceCounts[source] || 0;
          // 이 카드 하나만 단독으로 선택되어 있는지 확인
          const isSelected = selectedSources.length === 1 && selectedSources[0] === source;
          const isPress = PRESS_SOURCES.includes(source);
          
          return (
            <button 
              key={source}
              onClick={() => {
                setSelectedSources([source]);
                setCurrentPage(1);
              }}
              className={`p-4 rounded-xl border text-left transition-all duration-300 relative overflow-hidden group
                ${isSelected 
                  ? 'bg-blue-600 border-blue-600 shadow-md transform -translate-y-1 ring-4 ring-blue-100' 
                  : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow hover:-translate-y-0.5'
                }`}
            >
              <div className={`flex justify-between items-start mb-2 ${isSelected ? 'text-blue-200' : 'text-gray-400'}`}>
                {isPress ? <FileText className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
              </div>
              <div className={`text-xs font-bold mb-1 line-clamp-1 ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                {source}
              </div>
              <div className={`text-2xl font-black ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                {count}<span className={`text-sm font-medium ml-1 ${isSelected ? 'text-blue-200' : 'text-gray-400'}`}>건</span>
              </div>
              
              {/* 꾸밈 요소 */}
              <div className={`absolute -right-4 -bottom-4 w-16 h-16 rounded-full opacity-10 transition-transform group-hover:scale-125 ${isSelected ? 'bg-white' : 'bg-blue-500'}`}></div>
            </button>
          );
        })}
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
            {/* 1. 7일 이내 주요 공지 */}
            {topNotices.length > 0 && (
              <section className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] overflow-hidden print:shadow-none print:border-none">
                <div className="px-5 py-4 flex justify-between items-center bg-white border-b border-gray-200">
                  <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <Star className="w-6 h-6 text-[#3B82F6] fill-[#3B82F6]" /> 
                    7일 이내 주요 공지
                    <span className="bg-[#4285F4] text-white text-sm px-3 py-0.5 rounded-full ml-2">{topNotices.length}건</span>
                  </h2>
                  <button className="text-sm font-medium text-gray-600 border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 transition-colors">
                    전체 보기 →
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-white text-gray-500 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-4 font-semibold w-24 relative whitespace-nowrap">
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
                        <th className="px-4 py-4 font-semibold w-28 text-center whitespace-nowrap">날짜</th>
                        <th className="px-4 py-4 font-semibold w-56 whitespace-nowrap">기관</th>
                        <th className="px-4 py-4 font-semibold w-auto">제목</th>
                        <th className="px-4 py-4 font-semibold w-28 text-center whitespace-nowrap">구분</th>
                        <th className="px-4 py-4 font-semibold w-64 whitespace-nowrap">주요 키워드</th>
                        <th className="px-4 py-4 font-semibold w-32 text-center whitespace-nowrap">원문 바로가기</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {currentNotices.map((article) => {
                        const isDeleted = article.status === 'DELETED';
                        const analysis = analyzeArticle(article);

                        return (
                          <tr key={article.id} className={`hover:bg-gray-50 transition-colors ${isDeleted ? 'opacity-50' : ''}`}>
                            <td className="px-4 py-4 align-middle whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                                article.status === 'NEW' ? 'text-red-500 border border-red-200' : 
                                article.status === 'UPDATE' ? 'text-yellow-600 border border-yellow-200' :
                                article.status === 'DELETED' ? 'text-gray-500 border border-gray-200 line-through' :
                                'text-gray-500 border border-gray-200'
                              }`}>
                                {article.status}
                              </span>
                              {article.is_merged && (
                                <span className="block mt-1 text-[10px] text-blue-600 font-semibold">↳ AI 통합됨</span>
                              )}
                            </td>
                            <td className="px-4 py-4 align-middle text-gray-600 text-center text-sm font-medium whitespace-nowrap">
                              {new Date(article.published_date).toISOString().split('T')[0]}
                            </td>
                            <td className="px-4 py-4 align-middle font-medium text-gray-700">{article.source}</td>
                            <td className="px-4 py-4 align-middle">
                              <span className={`text-gray-800 font-medium ${isDeleted ? 'line-through' : ''}`}>
                                {article.title}
                              </span>
                              {article.is_merged && article.related_links && article.related_links.length > 0 && (
                                <div className="mt-2 pl-2 border-l-2 border-gray-200">
                                  <ul className="space-y-1">
                                    {article.related_links.map((link, idx) => (
                                      <li key={idx}>
                                        <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-[#C05A12] flex items-center gap-1">
                                          <span className="font-semibold">[{link.source}]</span>{link.title}
                                        </a>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-4 align-middle text-center whitespace-nowrap">
                              <span className={`inline-flex px-2 py-1 border rounded text-xs font-semibold ${analysis.categoryClassName}`}>
                                {analysis.category}
                              </span>
                            </td>
                            <td className="px-4 py-4 align-middle text-xs text-gray-600 font-medium">
                              {analysis.keywords}
                            </td>
                            <td className="px-4 py-4 align-middle text-center whitespace-nowrap">
                              <a href={article.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 transition-colors p-2 rounded-lg shadow-sm border border-blue-100" title="원문 바로가기">
                                <ExternalLink className="w-4 h-4" />
                              </a>
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
      
      {/* 4. '더보기' 모달 팝업 */}
      {modalSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Star className="w-6 h-6 text-[#3B82F6] fill-[#3B82F6]" />
                {modalSource} 전체 목록
                <span className="bg-[#4285F4] text-white text-sm px-3 py-0.5 rounded-full ml-2">{modalArticles.length}건</span>
              </h2>
              <button 
                onClick={() => setModalSource(null)}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-gray-600" />
              </button>
            </div>
            
            {/* Modal Body (Table) */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-white text-gray-500 border-b border-gray-200 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-4 py-4 font-semibold w-24 whitespace-nowrap">상태</th>
                    <th className="px-4 py-4 font-semibold w-32 text-center whitespace-nowrap">날짜</th>
                    <th className="px-4 py-4 font-semibold">제목</th>
                    <th className="px-4 py-4 font-semibold w-24 text-center whitespace-nowrap">구분</th>
                    <th className="px-4 py-4 font-semibold w-64 whitespace-nowrap">주요 키워드</th>
                    <th className="px-4 py-4 font-semibold w-32 text-center whitespace-nowrap">원문</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {currentModalArticles.map((article) => {
                    const isDeleted = article.status === 'DELETED';
                    const analysis = analyzeArticle(article);
                    return (
                      <tr key={article.id} className={`hover:bg-gray-50 transition-colors ${isDeleted ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-4 align-middle whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                            article.status === 'NEW' ? 'text-red-500 border border-red-200' : 
                            article.status === 'UPDATE' ? 'text-yellow-600 border border-yellow-200' :
                            article.status === 'DELETED' ? 'text-gray-500 border border-gray-200 line-through' :
                            'text-gray-500 border border-gray-200'
                          }`}>
                            {article.status}
                          </span>
                        </td>
                        <td className="px-4 py-4 align-middle text-gray-600 text-center text-sm font-medium whitespace-nowrap">
                          {new Date(article.published_date).toISOString().split('T')[0]}
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <div className={`text-base font-bold text-gray-800 ${isDeleted ? 'line-through' : ''}`}>
                            {article.title}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-middle text-center whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-1 rounded text-[11px] font-bold ${analysis.categoryClassName}`}>
                            {analysis.category}
                          </span>
                        </td>
                        <td className="px-4 py-4 align-middle text-gray-500 text-xs">
                          {analysis.keywords}
                        </td>
                        <td className="px-4 py-4 align-middle text-center">
                          <a href={article.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center p-2 text-blue-500 bg-blue-50 rounded hover:bg-blue-100 transition-colors group">
                            <ExternalLink className="w-4 h-4 group-hover:scale-110 transition-transform" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Modal Footer (Pagination) */}
            {modalTotalPages > 1 && (
              <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-center gap-4">
                <button 
                  onClick={() => setModalPage(p => Math.max(1, p - 1))}
                  disabled={modalPage === 1}
                  className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-sm font-medium text-gray-600">
                  {modalPage} / {modalTotalPages}
                </span>
                <button 
                  onClick={() => setModalPage(p => Math.min(modalTotalPages, p + 1))}
                  disabled={modalPage === modalTotalPages}
                  className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
