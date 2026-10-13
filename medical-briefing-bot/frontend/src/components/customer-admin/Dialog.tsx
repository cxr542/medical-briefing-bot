'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Dialog({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('input, textarea')?.focus();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, a[href]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onCancel={event => { event.preventDefault(); onClose(); }} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border-0 bg-white p-6 text-slate-800 shadow-2xl backdrop:bg-slate-900/40 sm:p-8">
      <div className="flex items-start justify-between gap-4"><h2 id={titleId} className="text-xl font-bold">{title}</h2><button type="button" onClick={onClose} aria-label="대화상자 닫기" className="ca-icon-button -mr-2 -mt-2"><X size={20} /></button></div>
      {description && <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-500">{description}</p>}
      {children}
    </dialog>
  );
}
