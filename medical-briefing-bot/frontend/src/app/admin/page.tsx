'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Home,
  NotebookTabs,
  RefreshCw,
  Shield,
  Trash2,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { releaseNotes } from '@/data/releaseNotes';
import {
  COLLECTION_DISPLAY_SCHEDULE_KST,
  getCollectionServiceStatus,
  getNextCollectionTime,
  userSourceStatusLabel,
} from '@/lib/collectionStatus';
import {
  COLLECTION_HEALTH_HISTORY_LIMIT,
  getCollectorHealth,
} from '@/lib/collectorHealthEngine.mjs';
import type { CollectorHealthState } from '@/lib/collectorHealthEngine.mjs';
import {
  formatKstTimestamp,
  formatSourceHealthSummary,
} from '@/lib/adminMonitoringFormatters.mjs';

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

type MonitoringPayload = {
  stats: Array<{ source: string; count: number }>;
  totalCount: number;
  statsError: string;
  collectorRuns: CollectorRun[];
  collectorRunsError: string;
};

type AuthStatus = 'checking' | 'anonymous' | 'authenticated' | 'unavailable';
type AdminView = 'monitoring' | 'releases';

const RESULT_LABEL = { SUCCESS: '정상', DEGRADED: '주의', FAILED: '실패' } as const;
const RESULT_CLASS = {
  SUCCESS: 'bg-green-100 text-green-700',
  DEGRADED: 'bg-yellow-100 text-yellow-700',
  FAILED: 'bg-red-100 text-red-700',
} as const;
const RESULT_ICON = {
  SUCCESS: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
  DEGRADED: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
  FAILED: <XCircle className="h-4 w-4" aria-hidden="true" />,
} as const;
const HEALTH_STATE_LABEL: Record<CollectorHealthState, string> = {
  NORMAL: '정상',
  DEGRADED: '일부 지연',
  FAILED: '수집 실패',
  STALE: '최신 상태 지연',
};
const HEALTH_STATE_CLASS: Record<CollectorHealthState, string> = {
  NORMAL: 'bg-green-100 text-green-700',
  DEGRADED: 'bg-yellow-100 text-yellow-700',
  FAILED: 'bg-red-100 text-red-700',
  STALE: 'bg-gray-200 text-gray-700',
};
const SOURCE_STATUS_CLASS = {
  OK: 'bg-green-100 text-green-700',
  WARN: 'bg-yellow-100 text-yellow-700',
  FAILED: 'bg-red-100 text-red-700',
} as const;

const emptyMonitoringPayload: MonitoringPayload = {
  stats: [],
  totalCount: 0,
  statsError: '',
  collectorRuns: [],
  collectorRunsError: '',
};

export default function AdminPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [adminError, setAdminError] = useState('');
  const [monitoring, setMonitoring] = useState(emptyMonitoringPayload);
  const [isLoading, setIsLoading] = useState(true);
  const [adminView, setAdminView] = useState<AdminView>('monitoring');

  const loadMonitoring = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/monitoring', { cache: 'no-store' });
      setAdminError('');
      if (response.status === 401) {
        setMonitoring(emptyMonitoringPayload);
        setAuthStatus('anonymous');
        return false;
      }
      if (!response.ok) {
        setAdminError('운영 정보를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.');
        setAuthStatus(current => current === 'checking' ? 'unavailable' : current);
        return false;
      }

      const payload = await response.json() as MonitoringPayload;
      setMonitoring(payload);
      setAuthStatus('authenticated');
      setLoginError('');
      return true;
    } catch {
      setAdminError('운영 정보를 불러올 수 없습니다. 네트워크 상태를 확인해주세요.');
      setAuthStatus(current => current === 'checking' ? 'unavailable' : current);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/admin/monitoring', { cache: 'no-store', signal: controller.signal })
      .then(async response => ({
        response,
        payload: response.ok ? await response.json() as MonitoringPayload : null,
      }))
      .then(({ response, payload }) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setMonitoring(emptyMonitoringPayload);
          setAuthStatus('anonymous');
          return;
        }
        if (!response.ok || !payload) {
          setAdminError('운영 정보를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.');
          setAuthStatus('unavailable');
          return;
        }

        setMonitoring(payload);
        setAuthStatus('authenticated');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAdminError('운영 정보를 불러올 수 없습니다. 네트워크 상태를 확인해주세요.');
          setAuthStatus('unavailable');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, []);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError('');
    setAdminError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      setPassword('');

      if (!response.ok) {
        setLoginError(response.status === 401
          ? '인증 정보가 올바르지 않습니다.'
          : '로그인할 수 없습니다. 잠시 후 다시 시도해주세요.');
        return;
      }

      setAuthStatus('authenticated');
      await loadMonitoring();
    } catch {
      setPassword('');
      setLoginError('로그인할 수 없습니다. 네트워크 상태를 확인해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/admin/logout', { method: 'POST' });
      if (!response.ok) {
        setAdminError('로그아웃 요청을 완료하지 못했습니다. 다시 시도해주세요.');
        return;
      }
      setMonitoring(emptyMonitoringPayload);
      setAuthStatus('anonymous');
      setAdminView('monitoring');
      setAdminError('');
    } catch {
      setAdminError('로그아웃 요청을 완료하지 못했습니다. 다시 시도해주세요.');
    }
  };

  const collectorRuns = monitoring.collectorRuns;
  const latestRun = collectorRuns[0];
  const collectorHealth = getCollectorHealth(collectorRuns);
  const userServiceStatus = getCollectionServiceStatus(latestRun);
  const nextCollectionTime = getNextCollectionTime();
  const affectedSourceCount = collectorHealth.sources.filter(source => source.currentStatus !== 'OK').length;

  if (authStatus === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FDFBF7] p-4 text-sm text-gray-600" aria-live="polite">
        관리자 세션을 확인하고 있습니다...
      </main>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FDFBF7] p-4">
        <section className="w-full max-w-md rounded-2xl border border-[#E8DCCB] bg-white p-6 shadow-xl sm:p-8" aria-labelledby="admin-login-title">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#F5EFE6]">
              <Shield className="h-8 w-8 text-[#5C2D0C]" aria-hidden="true" />
            </div>
          </div>
          <h1 id="admin-login-title" className="mb-2 text-center text-2xl font-bold text-[#5C2D0C]">관리자 페이지</h1>
          <p className="mb-8 text-center text-sm text-gray-500">시스템 관리를 위해 관리자 비밀번호를 입력해주세요.</p>

          {(loginError || (authStatus === 'unavailable' && adminError)) && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
              {loginError || '관리자 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'}
            </p>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="admin-password" className="sr-only">관리자 비밀번호</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="비밀번호 입력"
                autoComplete="current-password"
                required
                maxLength={512}
                className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-[#C05A12] focus:outline-none focus:ring-2 focus:ring-[#C05A12]"
              />
            </div>
            <button
              type="submit"
              disabled={!password || isLoading}
              className="min-h-12 w-full rounded-xl bg-[#5C2D0C] py-3 font-bold text-white transition-colors hover:bg-[#4A240A] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? '확인 중...' : '접속하기'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/" className="inline-flex min-h-10 items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#C05A12]">
              <Home className="h-4 w-4" aria-hidden="true" /> 메인 홈으로 돌아가기
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen w-full min-w-0 max-w-full overflow-x-hidden bg-[#FDFBF7] pb-20 font-sans">
      <header className="sticky top-0 z-10 flex flex-col items-start justify-between gap-3 bg-[#1F2937] px-4 py-4 text-white shadow-md sm:px-6 md:flex-row md:items-center">
        <h1 className="flex min-w-0 items-center gap-2 text-lg font-bold md:text-xl">
          <Shield className="h-6 w-6 shrink-0 text-yellow-400" aria-hidden="true" />
          <span className="break-words">의료 브리핑 봇 관리자 대시보드</span>
        </h1>
        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          <Link href="/" className="inline-flex min-h-10 items-center gap-1 text-sm text-gray-300 transition-colors hover:text-white">
            <Home className="h-4 w-4" aria-hidden="true" /> 서비스 뷰
          </Link>
          <button onClick={handleLogout} className="min-h-10 rounded-lg bg-gray-700 px-3 py-2 text-sm transition-colors hover:bg-gray-600">
            로그아웃
          </button>
        </div>
      </header>

      <main className="mx-auto mt-6 w-full min-w-0 max-w-6xl px-4 sm:px-6 md:mt-8">
        {adminError && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{adminError}</p>}
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="관리자 메뉴">
          <button
            onClick={() => setAdminView('monitoring')}
            aria-current={adminView === 'monitoring' ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors ${adminView === 'monitoring' ? 'bg-[#5C2D0C] text-white' : 'border border-[#E8DCCB] bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <Activity className="h-4 w-4" aria-hidden="true" /> Monitoring
          </button>
          <button
            onClick={() => setAdminView('releases')}
            aria-current={adminView === 'releases' ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors ${adminView === 'releases' ? 'bg-[#5C2D0C] text-white' : 'border border-[#E8DCCB] bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <NotebookTabs className="h-4 w-4" aria-hidden="true" /> 릴리즈 노트
          </button>
        </nav>

        {adminView === 'releases' ? (
          <section className="space-y-5" aria-labelledby="release-notes-heading">
            <div className="rounded-xl border border-[#E8DCCB] bg-white px-5 py-5 shadow-sm sm:px-6">
              <h2 id="release-notes-heading" className="flex items-center gap-2 text-xl font-black text-gray-800"><NotebookTabs className="h-5 w-5 text-[#C05A12]" aria-hidden="true" /> 릴리즈 노트</h2>
              <p className="mt-1 text-sm text-gray-500">Medical Briefing Bot의 주요 변경, 장애 복구 및 운영 검증 이력입니다.</p>
            </div>
            {releaseNotes.map(note => (
              <article key={note.id} className="overflow-hidden rounded-xl border border-[#E8DCCB] bg-white shadow-sm">
                <div className="border-b border-gray-100 bg-gray-50 px-5 py-5 sm:px-6">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500"><time>{note.date}</time><span className="rounded-full bg-orange-100 px-2 py-1 font-bold text-orange-700">{note.category}</span></div>
                  <h3 className="mt-2 text-lg font-black text-gray-800">{note.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{note.summary}</p>
                </div>
                <div className="grid gap-6 p-5 lg:grid-cols-3 sm:p-6">
                  <div><h4 className="mb-2 font-bold text-gray-800">해결된 문제</h4><ul className="list-disc space-y-2 pl-5 text-sm text-gray-600">{note.issues.map(item => <li key={item}>{item}</li>)}</ul></div>
                  <div><h4 className="mb-2 font-bold text-gray-800">주요 변경</h4><ul className="list-disc space-y-2 pl-5 text-sm text-gray-600">{note.changes.map(item => <li key={item}>{item}</li>)}</ul></div>
                  <div><h4 className="mb-2 font-bold text-gray-800">검증 결과</h4><ul className="list-disc space-y-2 pl-5 text-sm text-gray-600">{note.verification.map(item => <li key={item}>{item}</li>)}</ul></div>
                </div>
                <div className="flex flex-wrap gap-2 px-5 pb-5 sm:px-6 sm:pb-6">
                  {note.links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50">{link.label}</a>)}
                </div>
              </article>
            ))}
          </section>
        ) : (
          <>
            <section className="mb-8 overflow-hidden rounded-xl border border-[#E8DCCB] bg-white shadow-sm" aria-labelledby="collector-overview-heading">
              <div className="flex flex-col justify-between gap-3 border-b border-gray-100 bg-gray-50 px-5 py-5 sm:flex-row sm:items-center sm:px-6">
                <div>
                  <h2 id="collector-overview-heading" className="flex items-center gap-2 font-bold text-gray-800"><Activity className="h-5 w-5 text-[#C05A12]" aria-hidden="true" /> 수집 운영 상태</h2>
                  <p className="mt-1 text-xs text-gray-500">최근 GitHub Actions Collector 실행 결과</p>
                </div>
                {latestRun && <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${RESULT_CLASS[latestRun.result]}`}>{RESULT_ICON[latestRun.result]} {RESULT_LABEL[latestRun.result]}</span>}
              </div>
              <div className="p-4 sm:p-6">
                {monitoring.collectorRunsError && <p className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-700">{monitoring.collectorRunsError}</p>}
                {isLoading && !latestRun ? <div className="py-8 text-center text-gray-500" aria-live="polite">운영 상태를 조회하고 있습니다...</div> : latestRun ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                      <div className="min-w-0 rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">마지막 수집</p><p className="mt-1 break-words text-sm font-bold text-gray-800">{formatKstTimestamp(latestRun.finished_at)}</p></div>
                      <div className="rounded-lg bg-blue-50 p-3"><p className="text-xs text-blue-600">Collected</p><p className="mt-1 text-xl font-black text-blue-800">{latestRun.collected_count}</p></div>
                      <div className="rounded-lg bg-purple-50 p-3"><p className="text-xs text-purple-600">AI output</p><p className="mt-1 text-xl font-black text-purple-800">{latestRun.ai_output_count}</p></div>
                      <div className="rounded-lg bg-orange-50 p-3"><p className="text-xs text-orange-600">DB attempted</p><p className="mt-1 text-xl font-black text-orange-800">{latestRun.db_attempted}</p></div>
                      <div className="rounded-lg bg-green-50 p-3"><p className="text-xs text-green-600">DB succeeded</p><p className="mt-1 text-xl font-black text-green-800">{latestRun.db_succeeded}</p></div>
                      <div className="rounded-lg bg-red-50 p-3"><p className="text-xs text-red-600">DB failed</p><p className="mt-1 text-xl font-black text-red-800">{latestRun.db_failed}</p></div>
                    </div>

                    <section className="mt-6 rounded-xl border border-[#E8DCCB] bg-[#FDFBF7] p-4 sm:p-5" aria-labelledby="collector-health-heading">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <h3 id="collector-health-heading" className="font-bold text-gray-800">Collector Health Engine</h3>
                          <p className="mt-1 text-xs text-gray-500">최근 {COLLECTION_HEALTH_HISTORY_LIMIT}회 source 이력을 추적하며 runtime 다음 수집 시각 + 2시간 유예로 stale을 판단합니다.</p>
                        </div>
                        <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-bold ${HEALTH_STATE_CLASS[collectorHealth.state]}`}>
                          {HEALTH_STATE_LABEL[collectorHealth.state]}
                        </span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div className="rounded-lg bg-white p-3"><dt className="text-xs text-gray-500">연속 DEGRADED</dt><dd className="mt-1 text-lg font-black text-gray-800">{collectorHealth.consecutiveDegradedRuns}회</dd></div>
                        <div className="rounded-lg bg-white p-3"><dt className="text-xs text-gray-500">영향 source</dt><dd className="mt-1 text-lg font-black text-gray-800">{affectedSourceCount}개</dd></div>
                        <div className="rounded-lg bg-white p-3"><dt className="text-xs text-gray-500">마지막 실행</dt><dd className="mt-1 break-words text-sm font-bold text-gray-800">{formatKstTimestamp(collectorHealth.latestRunAt)}</dd></div>
                        <div className="rounded-lg bg-white p-3"><dt className="text-xs text-gray-500">STALE 감지 시각</dt><dd className="mt-1 break-words text-sm font-bold text-gray-800">{formatKstTimestamp(collectorHealth.staleAt)}</dd></div>
                      </dl>
                    </section>

                    <div className="mt-6 min-w-0">
                      <h3 className="mb-3 font-bold text-gray-800">기관별 수집 이력 상태</h3>
                      <div className="max-w-full overflow-x-auto rounded-lg border border-gray-100">
                        <table className="w-full min-w-[1240px] text-left text-sm">
                          <caption className="sr-only">최근 {COLLECTION_HEALTH_HISTORY_LIMIT}회 source별 수집 및 복구 이력</caption>
                          <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr>
                            <th scope="col" className="px-4 py-3">기관/출처</th><th scope="col" className="px-4 py-3">최근 건수</th><th scope="col" className="px-4 py-3">현재 상태</th><th scope="col" className="px-4 py-3">최근 실행 사유</th><th scope="col" className="px-4 py-3">마지막 정상 수집</th><th scope="col" className="px-4 py-3">연속 실패</th><th scope="col" className="px-4 py-3">최근 실패 원인</th><th scope="col" className="px-4 py-3">마지막 시도</th><th scope="col" className="px-4 py-3">마지막 복구</th><th scope="col" className="px-4 py-3">최근 상태</th>
                          </tr></thead>
                          <tbody>
                            {collectorHealth.sources.map(source => (
                              <tr key={source.name} className="align-top border-b border-gray-100 last:border-0">
                                <td className="max-w-48 break-words whitespace-normal px-4 py-3 font-semibold text-gray-700">{source.name}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-gray-600">{source.count}</td>
                                <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${HEALTH_STATE_CLASS[source.state]}`}>{HEALTH_STATE_LABEL[source.state]}</span><span className="ml-2 text-xs text-gray-500">{source.currentStatus}</span></td>
                                <td className="max-w-72 break-words whitespace-normal px-4 py-3 text-gray-500">{source.reason || '-'}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatKstTimestamp(source.lastSuccessAt)}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-gray-600">{source.consecutiveFailures}회</td>
                                <td className="max-w-72 break-words whitespace-normal px-4 py-3 text-gray-500">{source.latestFailureReason || '-'}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatKstTimestamp(source.latestAttemptAt)}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatKstTimestamp(source.lastRecoveryAt)}</td>
                                <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{source.recentStatuses.map((entry, index) => <span key={`${entry.finishedAt}-${index}`} className={`rounded-full px-2 py-1 text-xs font-bold ${SOURCE_STATUS_CLASS[entry.status]}`}>{entry.status}</span>)}</div></td>
                              </tr>
                            ))}
                            {collectorHealth.sources.length === 0 && <tr><td colSpan={10} className="px-4 py-6 text-center text-sm text-gray-500">{monitoring.collectorRunsError || 'source health 이력이 없습니다.'}</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : !isLoading && !monitoring.collectorRunsError ? (
                  <div className="py-8 text-center text-gray-500">저장된 collector 실행 이력이 없습니다.</div>
                ) : null}
              </div>
            </section>

            <section className="mb-8 overflow-hidden rounded-xl border border-[#E8DCCB] bg-white shadow-sm" aria-labelledby="collection-schedule-heading">
              <div className="border-b border-gray-100 bg-gray-50 px-5 py-5 sm:px-6"><h2 id="collection-schedule-heading" className="font-bold text-gray-800">수집 일정</h2><p className="mt-1 text-xs text-gray-500">한국시간(KST) 기준 Daily Collector 실행 일정</p></div>
              <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 sm:p-6">
                <div className="rounded-lg bg-blue-50 p-4"><p className="text-xs text-blue-600">매일 실행</p><p className="mt-1 text-lg font-black text-blue-800">{COLLECTION_DISPLAY_SCHEDULE_KST.join(' · ')}</p></div>
                <div className="rounded-lg bg-purple-50 p-4"><p className="text-xs text-purple-600">다음 수집 예정</p><p className="mt-1 text-lg font-black text-purple-800">{nextCollectionTime}</p></div>
              </div>
            </section>

            <section className="mb-8 overflow-hidden rounded-xl border border-[#E8DCCB] bg-white shadow-sm" aria-labelledby="user-service-status-heading">
              <div className="border-b border-gray-100 bg-gray-50 px-5 py-5 sm:px-6"><h2 id="user-service-status-heading" className="flex items-center gap-2 font-bold text-gray-800"><Activity className="h-5 w-5 text-[#C05A12]" aria-hidden="true" /> 사용자 서비스 상태</h2><p className="mt-1 text-xs text-gray-500">사용자 메인 화면에 표시되는 상태를 공통 판정 기준으로 확인합니다.</p></div>
              <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 lg:grid-cols-4 sm:p-6">
                <div className="rounded-lg bg-gray-50 p-4"><p className="text-xs text-gray-500">상태</p><p className="mt-1 font-bold text-gray-800">{userServiceStatus.message}</p></div>
                <div className={`rounded-lg p-4 ${userServiceStatus.showBanner ? 'bg-yellow-50' : 'bg-green-50'}`}><p className="text-xs text-gray-500">사용자 화면</p><p className="mt-1 font-bold text-gray-800">{userServiceStatus.showBanner ? '경고 배너 표시 중' : '경고 없음'}</p></div>
                <div className="rounded-lg bg-blue-50 p-4"><p className="text-xs text-blue-600">영향 소스</p><p className="mt-1 text-xl font-black text-blue-800">{userServiceStatus.affectedCount}개</p></div>
                <div className="rounded-lg bg-purple-50 p-4"><p className="text-xs text-gray-500">Collector / Stale</p><p className="mt-1 font-bold text-purple-800">{latestRun?.result || '확인 불가'} / {userServiceStatus.stale ? '예' : '아니오'}</p></div>
              </div>
              <div className="px-5 pb-5 text-sm text-gray-600 sm:px-6 sm:pb-6">마지막 확인: {formatKstTimestamp(userServiceStatus.finishedAt)}</div>
              {userServiceStatus.affectedSources.length > 0 && <div className="px-5 pb-5 sm:px-6 sm:pb-6"><ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">{userServiceStatus.affectedSources.map(source => <li key={source.name} className="flex min-w-0 justify-between gap-4 rounded-lg border border-gray-100 px-3 py-2"><span className="break-words">{source.name}</span><span className="shrink-0 font-semibold text-gray-600">{userSourceStatusLabel[source.status]}</span></li>)}</ul></div>}
            </section>

            <section className="mb-8 overflow-hidden rounded-xl border border-[#E8DCCB] bg-white shadow-sm" aria-labelledby="collector-history-heading">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-5 py-5 sm:px-6"><div className="flex items-center gap-2"><Clock className="h-5 w-5 text-gray-500" aria-hidden="true" /><h2 id="collector-history-heading" className="font-bold text-gray-800">최근 collector 실행 이력</h2></div><span className="text-xs text-gray-500">최근 10회 · 시각은 KST</span></div>
              <div className="max-w-full overflow-x-auto">
                <table className="w-full min-w-[1040px] text-left text-sm">
                  <caption className="sr-only">최근 Collector 실행 10회의 시각, 결과, 수집, AI, DB, source 상태와 duration</caption>
                  <thead className="bg-gray-50 text-xs text-gray-500"><tr><th scope="col" className="whitespace-nowrap px-4 py-3">실행 시각 (KST)</th><th scope="col" className="whitespace-nowrap px-4 py-3">결과</th><th scope="col" className="whitespace-nowrap px-4 py-3">수집</th><th scope="col" className="whitespace-nowrap px-4 py-3">AI output</th><th scope="col" className="px-4 py-3">Source health</th><th scope="col" className="whitespace-nowrap px-4 py-3">DB 성공</th><th scope="col" className="whitespace-nowrap px-4 py-3">DB 실패</th><th scope="col" className="whitespace-nowrap px-4 py-3">실행 시간</th></tr></thead>
                  <tbody>
                    {collectorRuns.slice(0, 10).map(run => {
                      const sourceSummary = formatSourceHealthSummary(run.source_health);
                      const sourceProblem = /WARN|FAILED/.test(sourceSummary);
                      const durationSeconds = Math.max(0, Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000));
                      return (
                        <tr key={run.id} className="border-t border-gray-100 align-top">
                          <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatKstTimestamp(run.finished_at)}</td>
                          <td className="whitespace-nowrap px-4 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${RESULT_CLASS[run.result]}`}>{RESULT_ICON[run.result]} {RESULT_LABEL[run.result]}</span></td>
                          <td className="whitespace-nowrap px-4 py-3">{run.collected_count}</td>
                          <td className="whitespace-nowrap px-4 py-3">{run.ai_output_count}</td>
                          <td className="px-4 py-3"><span className={`inline-block max-w-full break-words rounded-full px-2 py-1 text-xs font-bold ${sourceProblem ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{sourceSummary}</span></td>
                          <td className="whitespace-nowrap px-4 py-3 text-green-700">{run.db_succeeded}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-red-700">{run.db_failed}</td>
                          <td className="whitespace-nowrap px-4 py-3">{durationSeconds}초</td>
                        </tr>
                      );
                    })}
                    {collectorRuns.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">{monitoring.collectorRunsError || '저장된 실행 이력이 없습니다.'}</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {monitoring.statsError && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{monitoring.statsError}</p>}
            <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
              <div className="flex items-center gap-4 rounded-xl border border-[#E8DCCB] bg-white p-5 shadow-sm sm:p-6"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50"><Database className="h-6 w-6 text-blue-600" aria-hidden="true" /></div><div><p className="text-sm font-semibold text-gray-500">총 누적 기사 수</p><h2 className="text-3xl font-black text-gray-800">{monitoring.totalCount.toLocaleString()}건</h2></div></div>
              <div className="flex items-center gap-4 rounded-xl border border-[#E8DCCB] bg-white p-5 shadow-sm sm:p-6"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green-50"><Activity className="h-6 w-6 text-green-600" aria-hidden="true" /></div><div><p className="text-sm font-semibold text-gray-500">수집 출처 갯수</p><h2 className="text-3xl font-black text-gray-800">{monitoring.stats.length}개</h2></div></div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E8DCCB] bg-white p-5 shadow-sm sm:p-6"><div className="flex min-w-0 items-center gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-50"><RefreshCw className={`h-6 w-6 text-orange-600 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" /></div><div><p className="text-sm font-semibold text-gray-500">데이터 새로고침</p><p className="mt-1 text-xs text-gray-400">실시간 통계를 다시 가져옵니다.</p></div></div><button onClick={() => { setIsLoading(true); void loadMonitoring(); }} disabled={isLoading} className="min-h-10 shrink-0 rounded-lg bg-orange-100 px-4 py-2 font-bold text-orange-700 transition-colors hover:bg-orange-200 disabled:opacity-50">갱신</button></div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
              <section className="overflow-hidden rounded-xl border border-[#E8DCCB] bg-white shadow-sm lg:col-span-2" aria-labelledby="source-stats-heading">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-5 sm:px-6"><h3 id="source-stats-heading" className="flex items-center gap-2 font-bold text-gray-800"><Database className="h-5 w-5 text-gray-500" aria-hidden="true" /> 출처별 수집 현황 (최근 1000건 기준)</h3></div>
                <div className="p-5 sm:p-6"><div className="space-y-4">
                  {monitoring.stats.map((item, index) => (
                    <div key={item.source} className="flex min-w-0 items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3"><span className="w-5 shrink-0 text-sm font-bold text-gray-400">{index + 1}.</span><span className="break-words font-semibold text-gray-700">{item.source}</span></div>
                      <div className="flex w-1/2 min-w-24 items-center gap-3"><div className="h-2 w-full rounded-full bg-gray-100"><div className="h-2 rounded-full bg-[#C05A12]" style={{ width: `${Math.max(5, (item.count / Math.max(...monitoring.stats.map(stat => stat.count))) * 100)}%` }} /></div><span className="w-12 shrink-0 text-right text-sm font-bold text-gray-600">{item.count}건</span></div>
                    </div>
                  ))}
                  {monitoring.stats.length === 0 && !isLoading && <div className="py-10 text-center text-gray-500">수집된 데이터가 없습니다.</div>}
                </div></div>
              </section>

              <section className="h-fit overflow-hidden rounded-xl border border-[#E8DCCB] bg-white shadow-sm" aria-labelledby="admin-actions-heading">
                <div className="border-b border-gray-100 bg-gray-50 px-5 py-5 sm:px-6"><h3 id="admin-actions-heading" className="flex items-center gap-2 font-bold text-gray-800"><Shield className="h-5 w-5 text-gray-500" aria-hidden="true" /> 관리자 액션</h3></div>
                <div className="space-y-4 p-5 sm:p-6">
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <h4 className="mb-2 flex items-center gap-2 font-bold text-red-700"><Trash2 className="h-5 w-5" aria-hidden="true" /> 데이터 전체 삭제</h4>
                    <p className="mb-4 text-sm leading-relaxed text-red-600">DB에 저장된 <strong>모든 기사 데이터</strong>를 완전히 삭제합니다. 되돌릴 수 없는 작업이며 현재는 실행이 차단되어 있습니다.</p>
                    <button type="button" onClick={() => window.alert('데이터 초기화 기능은 현재 차단되어 있습니다.')} className="min-h-10 w-full rounded-lg bg-red-600 py-2 font-bold text-white transition-colors hover:bg-red-700">초기화 실행</button>
                  </div>
                  <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <h4 className="mb-2 flex items-center gap-2 font-bold text-blue-700"><Shield className="h-5 w-5" aria-hidden="true" /> DB 보안 (RLS) 상태</h4>
                    <p className="text-sm leading-relaxed text-blue-600">운영 데이터 접근은 인증된 서버 경로와 Supabase Row Level Security 정책으로 제한됩니다.</p>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
