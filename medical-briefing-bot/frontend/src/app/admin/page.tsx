'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Home, Shield, Database, Trash2, Activity, RefreshCw, Clock, CheckCircle2, AlertTriangle, XCircle, NotebookTabs } from 'lucide-react';
import { releaseNotes } from '@/data/releaseNotes';
import Link from 'next/link';
import { COLLECTION_DISPLAY_SCHEDULE_KST, getCollectionServiceStatus, getNextCollectionTime, userSourceStatusLabel } from '@/lib/collectionStatus';
import { COLLECTION_HEALTH_HISTORY_LIMIT, getCollectorHealth } from '@/lib/collectorHealthEngine.mjs';
import type { CollectorHealthState } from '@/lib/collectorHealthEngine.mjs';

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
  const [statsError, setStatsError] = useState('');
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [adminView, setAdminView] = useState<'monitoring' | 'releases'>('monitoring');

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
      supabase.from('collector_runs').select('id,started_at,finished_at,result,collected_count,ai_output_count,db_attempted,db_succeeded,db_failed,source_health').order('finished_at', { ascending: false }).limit(COLLECTION_HEALTH_HISTORY_LIMIT),
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
    setStatsError(articleResponse.error ? '기사 통계를 조회할 수 없습니다.' : '');
    if (count !== null) {
      setTotalCount(count);
    }
    if (runResponse.error) {
      setCollectorRunsError('collector_runs 테이블을 조회할 수 없습니다. SQL migration 적용 여부를 확인해주세요.');
    } else {
      setCollectorRunsError('');
      setCollectorRuns(runResponse.data || []);
    }
    setStatsLoaded(true);
    setIsLoading(false);
  };

  const latestRun = collectorRuns[0];
  const collectorHealth = getCollectorHealth(collectorRuns);
  const userServiceStatus = getCollectionServiceStatus(latestRun);
  const nextCollectionTime = getNextCollectionTime();
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
  const healthStateLabel: Record<CollectorHealthState, string> = {
    NORMAL: '정상',
    DEGRADED: '일부 지연',
    FAILED: '수집 실패',
    STALE: '최신 상태 지연',
  };
  const healthStateClass: Record<CollectorHealthState, string> = {
    NORMAL: 'bg-green-100 text-green-700',
    DEGRADED: 'bg-yellow-100 text-yellow-700',
    FAILED: 'bg-red-100 text-red-700',
    STALE: 'bg-gray-200 text-gray-700',
  };
  const recentStatusClass = {
    OK: 'bg-green-100 text-green-700',
    WARN: 'bg-yellow-100 text-yellow-700',
    FAILED: 'bg-red-100 text-red-700',
  } as const;
  const formatRunTime = (value: string | null) => (
    value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '기록 없음'
  );

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
        <header className="bg-[#1F2937] text-white py-4 px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-md sticky top-0 z-10">
        <h1 className="text-lg md:text-xl font-bold flex items-center gap-2 min-w-0">
          <Shield className="w-6 h-6 text-yellow-400" />
          의료 브리핑 봇 관리자 대시보드
        </h1>
        <div className="flex items-center gap-3 flex-wrap">
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
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="관리자 메뉴">
          <button onClick={() => setAdminView('monitoring')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors ${adminView === 'monitoring' ? 'bg-[#5C2D0C] text-white' : 'bg-white text-gray-600 border border-[#E8DCCB] hover:bg-gray-50'}`}><Activity className="w-4 h-4" /> Monitoring</button>
          <button onClick={() => setAdminView('releases')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors ${adminView === 'releases' ? 'bg-[#5C2D0C] text-white' : 'bg-white text-gray-600 border border-[#E8DCCB] hover:bg-gray-50'}`}><NotebookTabs className="w-4 h-4" /> 릴리즈 노트</button>
        </nav>

        {adminView === 'releases' ? (
          <section className="space-y-5">
            <div className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] px-6 py-5">
              <h2 className="text-xl font-black text-gray-800 flex items-center gap-2"><NotebookTabs className="w-5 h-5 text-[#C05A12]" /> 릴리즈 노트</h2>
              <p className="text-sm text-gray-500 mt-1">Medical Briefing Bot의 주요 변경, 장애 복구 및 운영 검증 이력입니다.</p>
            </div>
            {releaseNotes.map(note => (
              <article key={note.id} className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] overflow-hidden">
                <div className="px-6 py-5 border-b border-gray-100 bg-gray-50">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500"><time>{note.date}</time><span className="rounded-full bg-orange-100 px-2 py-1 font-bold text-orange-700">{note.category}</span></div>
                  <h3 className="mt-2 text-lg font-black text-gray-800">{note.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{note.summary}</p>
                </div>
                <div className="p-6 grid gap-6 lg:grid-cols-3">
                  <div><h4 className="font-bold text-gray-800 mb-2">해결된 문제</h4><ul className="space-y-2 text-sm text-gray-600 list-disc pl-5">{note.issues.map(item => <li key={item}>{item}</li>)}</ul></div>
                  <div><h4 className="font-bold text-gray-800 mb-2">주요 변경</h4><ul className="space-y-2 text-sm text-gray-600 list-disc pl-5">{note.changes.map(item => <li key={item}>{item}</li>)}</ul></div>
                  <div><h4 className="font-bold text-gray-800 mb-2">검증 결과</h4><ul className="space-y-2 text-sm text-gray-600 list-disc pl-5">{note.verification.map(item => <li key={item}>{item}</li>)}</ul></div>
                </div>
                <div className="px-6 pb-6 flex flex-wrap gap-2">
                  {note.links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="text-xs font-bold rounded-lg border border-gray-200 px-3 py-2 text-gray-600 hover:bg-gray-50">{link.label}</a>)}
                </div>
              </article>
            ))}
          </section>
        ) : (
          <>

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
            {isLoading && !latestRun ? <div className="py-8 text-center text-gray-500">운영 상태를 조회하고 있습니다...</div> : latestRun ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">마지막 수집</p><p className="mt-1 text-sm font-bold text-gray-800">{new Date(latestRun.finished_at).toLocaleString('ko-KR')}</p></div>
                  <div className="rounded-lg bg-blue-50 p-3"><p className="text-xs text-blue-600">Collected</p><p className="mt-1 text-xl font-black text-blue-800">{latestRun.collected_count}</p></div>
                  <div className="rounded-lg bg-purple-50 p-3"><p className="text-xs text-purple-600">AI output</p><p className="mt-1 text-xl font-black text-purple-800">{latestRun.ai_output_count}</p></div>
                  <div className="rounded-lg bg-orange-50 p-3"><p className="text-xs text-orange-600">DB attempted</p><p className="mt-1 text-xl font-black text-orange-800">{latestRun.db_attempted}</p></div>
                  <div className="rounded-lg bg-green-50 p-3"><p className="text-xs text-green-600">DB succeeded</p><p className="mt-1 text-xl font-black text-green-800">{latestRun.db_succeeded}</p></div>
                  <div className="rounded-lg bg-red-50 p-3"><p className="text-xs text-red-600">DB failed</p><p className="mt-1 text-xl font-black text-red-800">{latestRun.db_failed}</p></div>
                </div>

                <section className="mt-6 rounded-xl border border-[#E8DCCB] bg-[#FDFBF7] p-4 md:p-5" aria-labelledby="collector-health-heading">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 id="collector-health-heading" className="font-bold text-gray-800">Collector Health Engine</h3>
                      <p className="mt-1 text-xs text-gray-500">최근 {COLLECTION_HEALTH_HISTORY_LIMIT}회 source 이력을 추적하며 runtime 다음 수집 시각 + 2시간 유예로 stale을 판단합니다.</p>
                    </div>
                    <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-bold ${healthStateClass[collectorHealth.state]}`}>
                      {healthStateLabel[collectorHealth.state]}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-lg bg-white p-3"><dt className="text-xs text-gray-500">연속 DEGRADED</dt><dd className="mt-1 text-lg font-black text-gray-800">{collectorHealth.consecutiveDegradedRuns}회</dd></div>
                    <div className="rounded-lg bg-white p-3"><dt className="text-xs text-gray-500">영향 source</dt><dd className="mt-1 text-lg font-black text-gray-800">{collectorHealth.sources.filter(source => source.currentStatus !== 'OK').length}개</dd></div>
                    <div className="rounded-lg bg-white p-3"><dt className="text-xs text-gray-500">마지막 실행</dt><dd className="mt-1 text-sm font-bold text-gray-800">{formatRunTime(collectorHealth.latestRunAt)}</dd></div>
                    <div className="rounded-lg bg-white p-3"><dt className="text-xs text-gray-500">STALE 감지 시각</dt><dd className="mt-1 text-sm font-bold text-gray-800">{formatRunTime(collectorHealth.staleAt)}</dd></div>
                  </dl>
                </section>

                <div className="mt-6">
                  <h3 className="font-bold text-gray-800 mb-3">기관별 수집 이력 상태</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1240px] text-sm text-left">
                      <caption className="sr-only">최근 {COLLECTION_HEALTH_HISTORY_LIMIT}회 source별 수집 및 복구 이력</caption>
                      <thead className="text-xs uppercase text-gray-500 bg-gray-50">
                        <tr>
                          <th scope="col" className="px-4 py-3">기관/출처</th>
                          <th scope="col" className="px-4 py-3">최근 건수</th>
                          <th scope="col" className="px-4 py-3">현재 상태</th>
                          <th scope="col" className="px-4 py-3">최근 실행 사유</th>
                          <th scope="col" className="px-4 py-3">마지막 정상 수집</th>
                          <th scope="col" className="px-4 py-3">연속 실패</th>
                          <th scope="col" className="px-4 py-3">최근 실패 원인</th>
                          <th scope="col" className="px-4 py-3">마지막 시도</th>
                          <th scope="col" className="px-4 py-3">마지막 복구</th>
                          <th scope="col" className="px-4 py-3">최근 상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {collectorHealth.sources.map(source => (
                          <tr key={source.name} className="border-b border-gray-100 last:border-0 align-top">
                            <td className="px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">{source.name}</td>
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{source.count}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={`rounded-full px-2 py-1 text-xs font-bold ${healthStateClass[source.state]}`}>{healthStateLabel[source.state]}</span>
                              <span className="ml-2 text-xs text-gray-500">{source.currentStatus}</span>
                            </td>
                            <td className="max-w-72 px-4 py-3 text-gray-500">{source.reason || '-'}</td>
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatRunTime(source.lastSuccessAt)}</td>
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{source.consecutiveFailures}회</td>
                            <td className="max-w-72 px-4 py-3 text-gray-500">{source.latestFailureReason || '-'}</td>
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatRunTime(source.latestAttemptAt)}</td>
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatRunTime(source.lastRecoveryAt)}</td>
                            <td className="px-4 py-3"><div className="flex flex-wrap gap-1">
                              {source.recentStatuses.map((entry, index) => (
                                <span key={`${entry.finishedAt}-${index}`} className={`rounded-full px-2 py-1 text-xs font-bold ${recentStatusClass[entry.status]}`}>{entry.status}</span>
                              ))}
                            </div></td>
                          </tr>
                        ))}
                        {collectorHealth.sources.length === 0 && (
                          <tr><td colSpan={10} className="px-4 py-6 text-center text-sm text-gray-500">{collectorRunsError || 'source health 이력이 없습니다.'}</td></tr>
                        )}
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
          <div className="px-6 py-5 border-b border-gray-100 bg-gray-50">
            <h2 className="font-bold text-gray-800">수집 일정</h2>
            <p className="text-xs text-gray-500 mt-1">한국시간(KST) 기준 Daily Collector 실행 일정</p>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg bg-blue-50 p-4"><p className="text-xs text-blue-600">매일 실행</p><p className="mt-1 text-lg font-black text-blue-800">{COLLECTION_DISPLAY_SCHEDULE_KST.join(' · ')}</p></div>
            <div className="rounded-lg bg-purple-50 p-4"><p className="text-xs text-purple-600">다음 수집 예정</p><p className="mt-1 text-lg font-black text-purple-800">{nextCollectionTime}</p></div>
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] overflow-hidden mb-8">
          <div className="px-6 py-5 border-b border-gray-100 bg-gray-50">
            <h2 className="font-bold text-gray-800 flex items-center gap-2"><Activity className="w-5 h-5 text-[#C05A12]" /> 사용자 서비스 상태</h2>
            <p className="text-xs text-gray-500 mt-1">사용자 메인 화면에 표시되는 상태를 공통 판정 기준으로 확인합니다.</p>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg bg-gray-50 p-4"><p className="text-xs text-gray-500">상태</p><p className="mt-1 font-bold text-gray-800">{userServiceStatus.message}</p></div>
            <div className={`rounded-lg p-4 ${userServiceStatus.showBanner ? 'bg-yellow-50' : 'bg-green-50'}`}><p className="text-xs text-gray-500">사용자 화면</p><p className="mt-1 font-bold text-gray-800">{userServiceStatus.showBanner ? '경고 배너 표시 중' : '경고 없음'}</p></div>
            <div className="rounded-lg bg-blue-50 p-4"><p className="text-xs text-blue-600">영향 소스</p><p className="mt-1 text-xl font-black text-blue-800">{userServiceStatus.affectedCount}개</p></div>
            <div className="rounded-lg bg-purple-50 p-4"><p className="text-xs text-purple-600">Collector / Stale</p><p className="mt-1 font-bold text-purple-800">{latestRun?.result || '확인 불가'} / {userServiceStatus.stale ? '예' : '아니오'}</p></div>
          </div>
          <div className="px-6 pb-6 text-sm text-gray-600">마지막 확인: {userServiceStatus.finishedAt ? new Date(userServiceStatus.finishedAt).toLocaleString('ko-KR') : '확인 불가'}</div>
          {userServiceStatus.affectedSources.length > 0 && (
            <div className="px-6 pb-6"><ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">{userServiceStatus.affectedSources.map(source => <li key={source.name} className="flex justify-between rounded-lg border border-gray-100 px-3 py-2"><span>{source.name}</span><span className="font-semibold text-gray-600">{userSourceStatusLabel[source.status]}</span></li>)}</ul></div>
          )}
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-[#E8DCCB] overflow-hidden mb-8">
          <div className="px-6 py-5 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-500" />
            <h2 className="font-bold text-gray-800">최근 collector 실행 이력</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm text-left">
              <thead className="text-xs text-gray-500 bg-gray-50"><tr><th className="px-6 py-3 whitespace-nowrap">실행 시각</th><th className="px-6 py-3 whitespace-nowrap">결과</th><th className="px-6 py-3 whitespace-nowrap">수집 건수</th><th className="px-6 py-3 whitespace-nowrap">DB 성공</th><th className="px-6 py-3 whitespace-nowrap">DB 실패</th><th className="px-6 py-3 whitespace-nowrap">실행 시간</th></tr></thead>
              <tbody>
                {collectorRuns.slice(0, 10).map(run => (
                  <tr key={run.id} className="border-t border-gray-100">
                    <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{new Date(run.finished_at).toLocaleString('ko-KR')}</td>
                    <td className="px-6 py-3 whitespace-nowrap"><span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${resultClass[run.result]}`}>{resultIcon[run.result]} {resultLabel[run.result]}</span></td>
                    <td className="px-6 py-3 whitespace-nowrap">{run.collected_count}</td><td className="px-6 py-3 whitespace-nowrap">{run.db_succeeded}</td><td className="px-6 py-3 whitespace-nowrap">{run.db_failed}</td>
                    <td className="px-6 py-3 whitespace-nowrap">{Math.max(0, Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000))}초</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        
        {/* Overview Stats */}
        {statsError && <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{statsError}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E8DCCB] flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center">
              <Database className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500">총 누적 기사 수</p>
              <h2 className="text-3xl font-black text-gray-800">{statsLoaded ? `${totalCount.toLocaleString()}건` : '—'}</h2>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E8DCCB] flex items-center gap-4">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
              <Activity className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500">수집 출처 갯수</p>
              <h2 className="text-3xl font-black text-gray-800">{statsLoaded ? `${stats.length}개` : '—'}</h2>
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
          </>
        )}
      </main>
    </div>
  );
}
