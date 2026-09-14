'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Home, Shield, Database, Trash2, Activity, RefreshCw, Clock, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import Link from 'next/link';

type SourceHealth = Record<string, { count: number; status: 'OK' | 'WARN' | 'FAILED'; reason: string }>;

type CollectorRun = {
  id: number;
  started_at: string;
  finished_at: string;
  result: 'SUCCESS' | 'DEGRADED' | 'FAILED';
  collected_count: number;
  ai_output_count: number;
  db_attempted: number;
  db_succeeded: number;
  db_failed: number;
  source_health: SourceHealth;
};

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  const [stats, setStats] = useState<{source: string, count: number}[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [collectorRuns, setCollectorRuns] = useState<CollectorRun[]>([]);
  const [collectorRunsError, setCollectorRunsError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // 심플한 비밀번호 (추후 환경변수로 분리 권장)
    if (password.trim().toLowerCase() === 'admin1234!' || password.trim().toLowerCase() === 'admin1234') {
      setIsAuthenticated(true);
      fetchStats();
    } else {
      setError('비밀번호가 일치하지 않습니다.');
    }
  };

  const fetchStats = async () => {
    setIsLoading(true);
    const [articleResponse, runResponse] = await Promise.all([
      supabase.from('articles').select('source', { count: 'exact' }).limit(1000),
      supabase.from('collector_runs').select('*').order('finished_at', { ascending: false }).limit(10),
    ]);

    const { data, count } = articleResponse;
      
    if (data) {
      const counts: Record<string, number> = {};
      data.forEach(item => {
        counts[item.source] = (counts[item.source] || 0) + 1;
      });
      
      const statsArray = Object.entries(counts)
        .map(([source, c]) => ({ source, count: c }))
        .sort((a, b) => b.count - a.count);
        
      setStats(statsArray);
    }
    if (count !== null) {
      setTotalCount(count);
    }
    if (runResponse.error) {
      setCollectorRunsError('collector_runs 테이블을 조회할 수 없습니다. SQL migration 적용 여부를 확인해주세요.');
    } else {
      setCollectorRunsError('');
      setCollectorRuns(runResponse.data || []);
    }
    setIsLoading(false);
  };

  const latestRun = collectorRuns[0];
  const resultLabel = { SUCCESS: '정상', DEGRADED: '주의', FAILED: '실패' } as const;
  const resultClass = {
    SUCCESS: 'bg-green-100 text-green-700',
    DEGRADED: 'bg-yellow-100 text-yellow-700',
    FAILED: 'bg-red-100 text-red-700',
  } as const;
  const resultIcon = {
    SUCCESS: <CheckCircle2 className="w-4 h-4" />,
    DEGRADED: <AlertTriangle className="w-4 h-4" />,
    FAILED: <XCircle className="w-4 h-4" />,
  } as const;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-[#E8DCCB]">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[#F5EFE6] rounded-full flex items-center justify-center">
              <Shield className="w-8 h-8 text-[#5C2D0C]" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center text-[#5C2D0C] mb-2">관리자 페이지</h1>
          <p className="text-center text-gray-500 mb-8 text-sm">시스템 관리를 위해 비밀번호를 입력해주세요.</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#C05A12] focus:border-[#C05A12] transition-colors"
              />
            </div>
            {error && <p className="text-red-500 text-sm font-medium px-1">{error}</p>}
            <button 
              type="submit"
              className="w-full bg-[#5C2D0C] text-white font-bold py-3 rounded-xl hover:bg-[#4A240A] transition-colors"
            >
              접속하기
            </button>
          </form>
          
          <div className="mt-6 text-center">
            <Link href="/" className="text-sm text-gray-500 hover:text-[#C05A12] inline-flex items-center gap-1 transition-colors">
              <Home className="w-4 h-4" /> 메인 홈으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] font-sans pb-20">
      {/* Admin Header */}
      <header className="bg-[#1F2937] text-white py-4 px-6 flex items-center justify-between shadow-md sticky top-0 z-10">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-yellow-400" />
          의료 브리핑 봇 관리자 대시보드
        </h1>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-gray-300 hover:text-white flex items-center gap-1 transition-colors">
            <Home className="w-4 h-4" /> 서비스 뷰
          </Link>
          <button 
            onClick={() => setIsAuthenticated(false)}
            className="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            로그아웃
          </button>
        </div>
      </header>

      <main className="max-w-6xl w-full px-6 mx-auto mt-8">

        <section className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] overflow-hidden mb-8">
          <div className="px-6 py-5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#C05A12]" /> 수집 운영 상태
              </h2>
              <p className="text-xs text-gray-500 mt-1">최근 GitHub Actions collector 실행 결과</p>
            </div>
            {latestRun && (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold ${resultClass[latestRun.result]}`}>
                {resultIcon[latestRun.result]} {resultLabel[latestRun.result]}
              </span>
            )}
          </div>
          <div className="p-6">
            {collectorRunsError && <p className="mb-4 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">{collectorRunsError}</p>}
            {latestRun ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">마지막 수집</p><p className="mt-1 text-sm font-bold text-gray-800">{new Date(latestRun.finished_at).toLocaleString('ko-KR')}</p></div>
                  <div className="rounded-lg bg-blue-50 p-3"><p className="text-xs text-blue-600">Collected</p><p className="mt-1 text-xl font-black text-blue-800">{latestRun.collected_count}</p></div>
                  <div className="rounded-lg bg-purple-50 p-3"><p className="text-xs text-purple-600">AI output</p><p className="mt-1 text-xl font-black text-purple-800">{latestRun.ai_output_count}</p></div>
                  <div className="rounded-lg bg-orange-50 p-3"><p className="text-xs text-orange-600">DB attempted</p><p className="mt-1 text-xl font-black text-orange-800">{latestRun.db_attempted}</p></div>
                  <div className="rounded-lg bg-green-50 p-3"><p className="text-xs text-green-600">DB succeeded</p><p className="mt-1 text-xl font-black text-green-800">{latestRun.db_succeeded}</p></div>
                  <div className="rounded-lg bg-red-50 p-3"><p className="text-xs text-red-600">DB failed</p><p className="mt-1 text-xl font-black text-red-800">{latestRun.db_failed}</p></div>
                </div>

                <div className="mt-6">
                  <h3 className="font-bold text-gray-800 mb-3">기관별 최근 수집 상태</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs uppercase text-gray-500 bg-gray-50">
                        <tr><th className="px-4 py-3">기관/출처</th><th className="px-4 py-3">수집 건수</th><th className="px-4 py-3">상태</th><th className="px-4 py-3">사유</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(latestRun.source_health || {}).map(([source, health]) => (
                          <tr key={source} className="border-b border-gray-100 last:border-0">
                            <td className="px-4 py-3 font-semibold text-gray-700">{source}</td>
                            <td className="px-4 py-3 text-gray-600">{health.count}</td>
                            <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-bold ${health.status === 'OK' ? 'bg-green-100 text-green-700' : health.status === 'WARN' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{health.status}</span></td>
                            <td className="px-4 py-3 text-gray-500">{health.reason || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : !isLoading && !collectorRunsError ? (
              <div className="py-8 text-center text-gray-500">저장된 collector 실행 이력이 없습니다.</div>
            ) : null}
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] overflow-hidden mb-8">
          <div className="px-6 py-5 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-500" />
            <h2 className="font-bold text-gray-800">최근 collector 실행 이력</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase text-gray-500 bg-gray-50"><tr><th className="px-6 py-3">실행 시각</th><th className="px-6 py-3">결과</th><th className="px-6 py-3">Collected</th><th className="px-6 py-3">DB succeeded</th><th className="px-6 py-3">DB failed</th><th className="px-6 py-3">실행 시간</th></tr></thead>
              <tbody>
                {collectorRuns.map(run => (
                  <tr key={run.id} className="border-t border-gray-100">
                    <td className="px-6 py-3 text-gray-700">{new Date(run.finished_at).toLocaleString('ko-KR')}</td>
                    <td className="px-6 py-3"><span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${resultClass[run.result]}`}>{resultIcon[run.result]} {resultLabel[run.result]}</span></td>
                    <td className="px-6 py-3">{run.collected_count}</td><td className="px-6 py-3">{run.db_succeeded}</td><td className="px-6 py-3">{run.db_failed}</td>
                    <td className="px-6 py-3">{Math.max(0, Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000))}초</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        
        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E8DCCB] flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center">
              <Database className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500">총 누적 기사 수</p>
              <h2 className="text-3xl font-black text-gray-800">{totalCount.toLocaleString()}건</h2>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E8DCCB] flex items-center gap-4">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
              <Activity className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500">수집 출처 갯수</p>
              <h2 className="text-3xl font-black text-gray-800">{stats.length}개</h2>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E8DCCB] flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-50 rounded-full flex items-center justify-center">
                <RefreshCw className={`w-6 h-6 text-orange-600 ${isLoading ? 'animate-spin' : ''}`} />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-500">데이터 새로고침</p>
                <p className="text-xs text-gray-400 mt-1">실시간 통계 다시 가져오기</p>
              </div>
            </div>
            <button 
              onClick={fetchStats}
              disabled={isLoading}
              className="px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              갱신
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Source Stats */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-[#E8DCCB] overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Database className="w-5 h-5 text-gray-500" /> 출처별 수집 현황 (최근 1000건 기준)
              </h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {stats.map((item, idx) => (
                  <div key={item.source} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-400 w-5">{idx + 1}.</span>
                      <span className="font-semibold text-gray-700">{item.source}</span>
                    </div>
                    <div className="flex items-center gap-4 w-1/2">
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div 
                          className="bg-[#C05A12] h-2 rounded-full" 
                          style={{ width: `${Math.max(5, (item.count / Math.max(...stats.map(s => s.count))) * 100)}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-bold text-gray-600 w-12 text-right">{item.count}건</span>
                    </div>
                  </div>
                ))}
                {stats.length === 0 && !isLoading && (
                  <div className="text-center py-10 text-gray-500">수집된 데이터가 없습니다.</div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Actions */}
          <div className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] overflow-hidden h-fit">
            <div className="px-6 py-5 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Shield className="w-5 h-5 text-gray-500" /> 관리자 액션
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-4 border border-red-200 bg-red-50 rounded-xl">
                <h4 className="font-bold text-red-700 flex items-center gap-2 mb-2">
                  <Trash2 className="w-5 h-5" /> 데이터 전체 삭제
                </h4>
                <p className="text-sm text-red-600 mb-4 leading-relaxed">
                  DB에 저장된 <strong>모든 기사 데이터</strong>를 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다. (RLS 적용 후에는 서버 API를 통해야 합니다)
                </p>
                <button 
                  onClick={() => alert('RLS 보안 설정이 적용되면 서버 액션으로 구현해야 합니다. (현재는 차단됨)')}
                  className="w-full py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors"
                >
                  초기화 실행
                </button>
              </div>
              
              <div className="p-4 border border-blue-200 bg-blue-50 rounded-xl mt-4">
                <h4 className="font-bold text-blue-700 flex items-center gap-2 mb-2">
                  <Shield className="w-5 h-5" /> DB 보안 (RLS) 상태
                </h4>
                <p className="text-sm text-blue-600 leading-relaxed">
                  보안 강화를 위해 Supabase에서 <strong>Row Level Security</strong>를 반드시 켜주세요. 현재 누구나 데이터를 삭제할 수 있는 상태일 수 있습니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
