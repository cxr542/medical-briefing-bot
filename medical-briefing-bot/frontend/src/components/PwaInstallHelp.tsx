export default function PwaInstallHelp() {
  return (
    <details className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 print:hidden">
      <summary className="min-h-11 cursor-pointer content-center font-semibold text-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-4">홈 화면에 의료 브리핑 추가하기</summary>
      <div className="mt-3 space-y-2 break-keep leading-6">
        <p>아이폰: Safari의 공유 메뉴에서 ‘홈 화면에 추가’를 선택해 주세요.</p>
        <p>안드로이드: Chrome 메뉴에서 ‘홈 화면에 추가’ 또는 ‘앱 설치’를 선택해 주세요.</p>
        <p>추가한 곰돌이 아이콘을 누르면 브리핑을 앱처럼 열 수 있어요. 로그인과 인터넷 연결이 필요합니다.</p>
      </div>
    </details>
  );
}
