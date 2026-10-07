'use client';

/* Design 360 — overlay shells.

   WHEN TO USE WHICH
     Modal   a short, self-contained decision that blocks the page —
             confirm, a 1–4 field create, a destructive action.
             Centred, ≤560px, page underneath is inert.
     Drawer  extended work you do WHILE reading the page behind it —
             advanced filters, a record's detail, a long form, an
             audit trail. Slides from the right, page stays legible.

   Rule of thumb: if the person needs the page's context to answer, use a
   drawer. If answering replaces the page's context, use a modal. */

import { useEffect, useRef } from 'react';
import { Button } from './primitives';
import './ui.css';

function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      // Keep focus inside while the overlay is open.
      const f = ref.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button,input,select,textarea,a[href]')?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      restore.current?.focus?.();
    };
  }, [open, onClose]);

  return ref;
}

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

function Shell({ kind, open, onClose, title, subtitle, footer, children }: OverlayProps & { kind: 'modal' | 'drawer' }) {
  const ref = useOverlay(open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="u-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className={kind === 'modal' ? 'u-modal' : 'u-drawer'}
           role="dialog" aria-modal="true" aria-label={title}>
        <div className="u-ov-h">
          <div>
            <h2 className="u-ov-t">{title}</h2>
            {subtitle && <p className="u-ov-s">{subtitle}</p>}
          </div>
          <div className="u-ov-x">
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
          </div>
        </div>
        <div className="u-ov-b">{children}</div>
        {footer && <div className="u-ov-f">{footer}</div>}
      </div>
    </>
  );
}

/** Short, blocking decision. Centred. */
export function Modal(p: OverlayProps) { return <Shell kind="modal" {...p} />; }

/** Extended work alongside the page. Slides from the right. */
export function Drawer(p: OverlayProps) { return <Shell kind="drawer" {...p} />; }
