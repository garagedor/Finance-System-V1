'use client';

import { useEffect, useState } from 'react';
import type { AuthUser } from '../types/user';
import './LoginPage.css';

interface LoginPageProps {
    onLogin: (user: AuthUser) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [mfaCode, setMfaCode] = useState('');
    const [mfaRequired, setMfaRequired] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const [lockoutTime, setLockoutTime] = useState<number | null>(null);
    const [lockoutMs, setLockoutMs] = useState<number>(0);

    // Live lockout countdown
    useEffect(() => {
        if (!lockoutTime) {
            setLockoutMs(0);
            return;
        }
        const tick = () => {
            const remaining = Math.max(0, lockoutTime - Date.now());
            setLockoutMs(remaining);
            if (remaining <= 0) {
                setLockoutTime(null);
                setError('');
            }
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [lockoutTime]);

    const lockoutLabel = (() => {
        if (!lockoutMs) return null;
        const totalSec = Math.ceil(lockoutMs / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    })();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();

        // Prevent submission if currently in lockout period
        if (lockoutTime && Date.now() < lockoutTime) {
            const minutesLeft = Math.ceil((lockoutTime - Date.now()) / 60000);
            setError(`Too many login attempts. Please try again in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}.`);
            return;
        }

        setError('');
        setLoading(true);

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, password, mfa_code: mfaRequired ? mfaCode : undefined }),
            });

            const data = await res.json();

            if (!res.ok) {
                if (data.mfa_required) {
                    setMfaRequired(true);
                    setError(mfaRequired ? (data.error || 'Invalid 2FA code') : '');
                    return;
                }
                setError(data.error || 'Login failed');

                // If rate limited, initiate client-side lockout for 5 minutes
                if (res.status === 429) {
                    const unlockTime = Date.now() + 5 * 60 * 1000;
                    setLockoutTime(unlockTime);

                    // Automatically clear lockout after 5 minutes
                    setTimeout(() => {
                        setLockoutTime(null);
                        setError('');
                    }, 5 * 60 * 1000);
                }
                return;
            }

            // Clear form and call onLogin
            setName('');
            setPassword('');
            setMfaCode('');
            setMfaRequired(false);
            setLockoutTime(null);
            onLogin(data);
        } catch (err) {
            console.error('Login error:', err);
            setError('An error occurred during login');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-bg flex min-h-screen items-center justify-center p-4">
            <div className="login-card-glow w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#111827]">

                {/* Brand header */}
                <div className="border-b border-white/5 px-8 pb-8 pt-10 text-center">
                    <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 shadow-lg shadow-indigo-500/30">
                        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <rect x="3" y="3" width="22" height="19" rx="2" stroke="white" strokeWidth="1.8" fill="none"/>
                            <line x1="3" y1="9"  x2="25" y2="9"  stroke="white" strokeWidth="1.4"/>
                            <line x1="3" y1="14" x2="25" y2="14" stroke="white" strokeWidth="1.4"/>
                            <line x1="3" y1="19" x2="25" y2="19" stroke="white" strokeWidth="1.4"/>
                            <line x1="11" y1="22" x2="11" y2="26" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                            <line x1="17" y1="22" x2="17" y2="26" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                        </svg>
                    </div>
                    <h1 className="text-xl font-bold tracking-tight text-white">LBS Garage Door</h1>
                    <p className="mt-1 text-sm text-slate-400">Management Portal</p>
                </div>

                {/* Form */}
                <form onSubmit={handleLogin} className="flex flex-col gap-5 px-8 py-8">

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter your name"
                            disabled={loading}
                            className="login-input w-full rounded-xl border border-white/10 bg-[#1e293b] px-4 py-3 text-sm text-white placeholder:text-slate-500 transition-all focus:border-indigo-500 focus:bg-[#1e2d45] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Password
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            disabled={loading || mfaRequired}
                            className="login-input w-full rounded-xl border border-white/10 bg-[#1e293b] px-4 py-3 text-sm text-white placeholder:text-slate-500 transition-all focus:border-indigo-500 focus:bg-[#1e2d45] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                        />
                    </div>

                    {mfaRequired && (
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                                2FA Code
                            </label>
                            <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                value={mfaCode}
                                onChange={(e) => setMfaCode(e.target.value)}
                                placeholder="6-digit code from your authenticator"
                                disabled={loading}
                                autoFocus
                                className="login-input w-full rounded-xl border border-white/10 bg-[#1e293b] px-4 py-3 text-sm tracking-widest text-white placeholder:text-slate-500 transition-all focus:border-indigo-500 focus:bg-[#1e2d45] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                            />
                            <p className="text-xs text-slate-500">Or use a backup code.</p>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400 animate-fade-up">
                            <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                                <line x1="8" y1="5" x2="8" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                <circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>
                            </svg>
                            <div className="flex-1">
                                {error}
                                {lockoutLabel && (
                                    <div className="mt-1 font-mono text-xs font-bold tracking-wider text-red-300">
                                        Try again in {lockoutLabel}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !name || !password}
                        className="mt-1 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-500 hover:to-violet-500 hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                    >
                        {loading ? (
                            <span className="flex items-center justify-center gap-2">
                                <span className="inline-flex gap-1">
                                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/80 [animation-delay:0ms]" />
                                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/80 [animation-delay:150ms]" />
                                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/80 [animation-delay:300ms]" />
                                </span>
                                Signing in
                            </span>
                        ) : (
                            'Sign In'
                        )}
                    </button>
                </form>

                {/* Footer */}
                <div className="px-8 pb-7 text-center">
                    <p className="text-xs text-slate-600">© 2025 LBS Garage Door</p>
                </div>

            </div>
        </div>
    );
}
