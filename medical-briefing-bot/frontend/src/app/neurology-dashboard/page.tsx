import Link from "next/link";
import { ArrowLeft, Activity, Info } from "lucide-react";

export const metadata = {
  title: "NU 신경과 처방건당 약품목수 대시보드",
  description: "신경과 다빈도 상병 기준 처방 지표 분석 대시보드",
};

export default function NeurologyDashboard() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#333333] font-sans pb-20">
      {/* Header */}
      <header className="bg-[#5C2D0C] text-white py-5 px-4 md:px-8 flex items-center justify-between shadow-md sticky top-0 z-10 print:hidden">
        <h1 className="text-lg md:text-2xl font-bold flex items-center gap-3">
          <Link
            href="/"
            className="hover:bg-white/20 p-2 rounded-full transition-colors"
            title="돌아가기"
          >
            <ArrowLeft className="w-5 h-5 md:w-6 md:h-6" />
          </Link>
          📊 NU 신경과 처방건당 약품목수
        </h1>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl w-full px-4 md:px-8 mx-auto mt-8 space-y-8">
        
        {/* Project Goal */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-50 rounded-lg text-amber-600">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                약품목수 상대지수 프로젝트 — NU 신경과
              </h2>
              <p className="text-gray-700 font-medium text-lg">
                목표: 처방건당 약품목수 상대지수 <span className="text-amber-600 font-bold">0.9로 줄이기</span>
              </p>
              <ul className="mt-3 text-sm text-gray-600 space-y-1 list-disc list-inside">
                <li>상종평균(상대지수=1)보다 낮아야 상대지수 0.9(1등급)</li>
                <li>상대지수: 동일 평가군의 환자구성을 감안 시 기대되는 상병별 지표 대비 실제 발생한 지표 비율(평균=1)</li>
                <li>기준: 신경과 다빈도 상병 (심평원 제공자료), 2025년(연간) vs 2026년 1분기 비교</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Key Metrics Cards */}
        <section>
          <h3 className="text-lg font-bold text-gray-900 mb-4 px-1">핵심지표 (2026년 1분기 기준)</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Metric 1 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">💊</span>
                  <h4 className="font-semibold text-gray-800">처방건당 약품목수(개)</h4>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">본원</span>
                    <span className="font-bold text-gray-900">4.08</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">상종평균</span>
                    <span className="text-gray-700">3.69</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-50">
                <p className="text-sm font-medium text-amber-600">▲ 평균보다 0.39 높음</p>
                <p className="text-xs text-green-600 mt-1">격차 추이: 0.45 → 0.39 (축소)</p>
              </div>
            </div>

            {/* Metric 2 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">📋</span>
                  <h4 className="font-semibold text-gray-800">6품목이상 처방비율(%)</h4>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">본원</span>
                    <span className="font-bold text-gray-900">23.20%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">상종평균</span>
                    <span className="text-gray-700">18.95%</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-50">
                <p className="text-sm font-medium text-amber-600">▲ 평균보다 4.25%p 높음</p>
                <p className="text-xs text-green-600 mt-1">격차 추이: 4.72%p → 4.25%p (축소)</p>
              </div>
            </div>

            {/* Metric 3 - Warning */}
            <div className="bg-red-50/50 rounded-xl shadow-sm border border-red-100 p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">🧪</span>
                  <h4 className="font-semibold text-red-800">소화기용약 처방률(%)</h4>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">본원</span>
                    <span className="font-bold text-red-700">47.40%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">상종평균</span>
                    <span className="text-gray-700">39.14%</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-red-100/50">
                <p className="text-sm font-medium text-red-600">▲ 평균보다 8.26%p 높음</p>
                <p className="text-xs text-red-500 mt-1 font-semibold">격차 추이: 6.71%p → 8.26%p (확대 주의)</p>
              </div>
            </div>
          </div>
        </section>

        {/* Data Table */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 md:p-6 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">지표별 추이 (2025년 연간 → 2026년 1분기)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 bg-gray-50/50 uppercase">
                <tr>
                  <th className="px-6 py-4 font-semibold">지표</th>
                  <th className="px-6 py-4 font-semibold text-center">2025 귀원</th>
                  <th className="px-6 py-4 font-semibold text-center">2025 평균</th>
                  <th className="px-6 py-4 font-semibold text-center bg-gray-100/50">2025 격차</th>
                  <th className="px-6 py-4 font-semibold text-center text-blue-800">2026 1Q 귀원</th>
                  <th className="px-6 py-4 font-semibold text-center text-blue-800">2026 1Q 평균</th>
                  <th className="px-6 py-4 font-semibold text-center bg-blue-50 text-blue-900">2026 1Q 격차</th>
                  <th className="px-6 py-4 font-semibold text-center">격차 증감(1Q-연간)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-gray-900">처방건당 약품목수(개)</td>
                  <td className="px-6 py-4 text-center">4.16</td>
                  <td className="px-6 py-4 text-center">3.71</td>
                  <td className="px-6 py-4 text-center bg-red-50 text-red-600 font-medium">0.45</td>
                  <td className="px-6 py-4 text-center">4.08</td>
                  <td className="px-6 py-4 text-center">3.69</td>
                  <td className="px-6 py-4 text-center bg-red-50 text-red-600 font-medium">0.39</td>
                  <td className="px-6 py-4 text-center text-green-600 font-medium">-0.06 (축소)</td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-gray-900">6품목이상 처방비율(%)</td>
                  <td className="px-6 py-4 text-center">23.84%</td>
                  <td className="px-6 py-4 text-center">19.12%</td>
                  <td className="px-6 py-4 text-center bg-red-50 text-red-600 font-medium">4.72%</td>
                  <td className="px-6 py-4 text-center">23.20%</td>
                  <td className="px-6 py-4 text-center">18.95%</td>
                  <td className="px-6 py-4 text-center bg-red-50 text-red-600 font-medium">4.25%</td>
                  <td className="px-6 py-4 text-center text-green-600 font-medium">-0.47%p (축소)</td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-gray-900">소화기용약 처방률(%)</td>
                  <td className="px-6 py-4 text-center">45.90%</td>
                  <td className="px-6 py-4 text-center">39.19%</td>
                  <td className="px-6 py-4 text-center bg-red-50 text-red-600 font-medium">6.71%</td>
                  <td className="px-6 py-4 text-center">47.40%</td>
                  <td className="px-6 py-4 text-center">39.14%</td>
                  <td className="px-6 py-4 text-center bg-red-100 text-red-700 font-bold">8.26%</td>
                  <td className="px-6 py-4 text-center text-red-600 font-bold">+1.55%p (확대)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="bg-gray-50 p-4 border-t border-gray-100 flex items-start gap-2">
            <Info className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
            <p className="text-xs text-gray-500 leading-relaxed">
              격차 = 귀원(본원) − 평균(상종평균). 빨간 배경은 본원이 상종평균보다 높은 값(개선 필요), 초록 배경은 본원이 상종평균 이하인 값(양호)을 뜻합니다.<br/>
              * (G70-G73)은 2025년에만, (R25-R29)는 2026년 1분기에만 상위 목록에 나타났습니다.
            </p>
          </div>
        </section>

      </main>
    </div>
  );
}
