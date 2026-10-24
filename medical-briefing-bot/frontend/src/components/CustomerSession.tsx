'use client';
import { useEffect, useState } from 'react';

export default function CustomerSession() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    let redirected = false;
    let pending: Promise<void> | null = null;
    const leave = () => {
      if (disposed || redirected) return;
      redirected = true;
      window.location.replace('/login');
    };
    const check = () => {
      if (pending) return pending;
      pending = (async () => {
        try {
          const result = await fetch('/api/customer-auth/session', { cache: 'no-store' });
          if (!result.ok) leave();
        } catch { leave(); }
      })().finally(() => { pending = null; });
      return pending;
    };
    const hide = () => { document.documentElement.style.visibility = 'hidden'; };
    const show = async () => {
      await check();
      if (!disposed && !redirected) document.documentElement.style.visibility = '';
    };
    hide();
    void show();
    window.addEventListener('popstate', show);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    window.addEventListener('focus', show);
    const timer = setInterval(check, 60000);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('popstate', show);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      window.removeEventListener('focus', show);
      document.documentElement.style.visibility = '';
    };
  }, []);
  return <div>
    <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-current px-3 text-sm" onClick={async () => {
      setBusy(true);
      setError('');
      try {
        const result = await fetch('/api/customer-auth/logout', { method: 'POST', cache: 'no-store' });
        if (result.ok) window.location.replace('/login');
        else setError('로그아웃하지 못했습니다. 다시 시도해 주세요.');
      } catch { setError('로그아웃하지 못했습니다. 다시 시도해 주세요.'); }
      finally { setBusy(false); }
    }}>로그아웃</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
