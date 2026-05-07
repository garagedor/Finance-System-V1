'use client';

import React from 'react';

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  message?: string;
  action?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const DEFAULT_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
    <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const sizeMap = {
  sm: { wrap: 'py-8 gap-2',  iconBox: 'h-10 w-10', title: 'text-sm', message: 'text-xs' },
  md: { wrap: 'py-12 gap-3', iconBox: 'h-12 w-12', title: 'text-base', message: 'text-sm' },
  lg: { wrap: 'py-16 gap-4', iconBox: 'h-14 w-14', title: 'text-lg', message: 'text-sm' },
};

export function EmptyState({
  icon,
  title,
  message,
  action,
  size = 'md',
  className = '',
}: EmptyStateProps) {
  const s = sizeMap[size];
  return (
    <div className={`flex flex-col items-center justify-center text-center ${s.wrap} ${className} animate-fade-up`}>
      <div
        className={`flex ${s.iconBox} items-center justify-center rounded-2xl text-slate-500`}
        style={{
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.18)',
        }}
      >
        {icon ?? DEFAULT_ICON}
      </div>
      <p className={`font-semibold text-slate-200 ${s.title}`}>{title}</p>
      {message && <p className={`max-w-[320px] text-slate-500 ${s.message}`}>{message}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export default EmptyState;
