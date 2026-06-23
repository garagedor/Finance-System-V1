import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, Collection } from 'mongodb';
import bcrypt from 'bcryptjs';
import type { User, AuthUser } from '../../../types/user';
import { computeEffectivePermissions, signSessionToken } from '@/lib/rbac';
import { ensureRbacReady } from '@/lib/rbac-seed';

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const USERS_COLLECTION = 'users';

let cachedClient: MongoClient | null = null;

async function connectToDatabase(): Promise<Collection<User>> {
    if (cachedClient) {
        const db = cachedClient.db(DB_NAME);
        return db.collection<User>(USERS_COLLECTION);
    }

    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    cachedClient = client;

    const db = client.db(DB_NAME);
    return db.collection<User>(USERS_COLLECTION);
}

// Simple in-memory rate limiter
interface RateLimitInfo {
    attempts: number;
    resetTime: number;
}
const rateLimiter = new Map<string, RateLimitInfo>();
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 mins

export async function POST(req: NextRequest) {
    try {
        const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
        const now = Date.now();

        // Check rate limiting
        const limitInfo = rateLimiter.get(ip);
        if (limitInfo) {
            if (now > limitInfo.resetTime) {
                rateLimiter.delete(ip);
            } else if (limitInfo.attempts >= MAX_ATTEMPTS) {
                return NextResponse.json(
                    { error: 'Too many login attempts. Please try again in 5 minutes.' },
                    { status: 429 }
                );
            }
        }

        let { name, password, mfa_code } = await req.json();
        name = name?.trim();
        const mfaCode: string | undefined = typeof mfa_code === 'string' ? mfa_code.trim() : undefined;

        if (!name || !password) {
            return NextResponse.json(
                { error: 'Missing name or password' },
                { status: 400 }
            );
        }

        const usersCollection = await connectToDatabase();
        const user = await usersCollection.findOne({ name });
        console.log(`Login attempt for user: ${name}, found: ${!!user}`);

        if (!user || !user.password) {
            // Record failed attempt
            const currentAttempts = rateLimiter.get(ip)?.attempts || 0;
            rateLimiter.set(ip, { attempts: currentAttempts + 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
            return NextResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 }
            );
        }

        let isPasswordValid = false;

        // Check if the stored password is a bcrypt hash (starts with $2a$, $2b$, or $2y$)
        if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$')) {
            console.log('Detected hashed password, comparing...');
            isPasswordValid = await bcrypt.compare(password, user.password);
        } else {
            // Plaintext password migration path
            console.log('Detected plaintext password, comparing...');
            if (user.password === password) {
                isPasswordValid = true;
                // Auto-migrate to hashed password
                const hashedPassword = await bcrypt.hash(password, 10);
                await usersCollection.updateOne(
                    { _id: user._id },
                    { $set: { password: hashedPassword } }
                );
                console.log('Auto-migrated plaintext password to hash');
            }
        }
        console.log(`Password valid: ${isPasswordValid}`);

        if (!isPasswordValid) {
            // Record failed attempt
            const currentAttempts = rateLimiter.get(ip)?.attempts || 0;
            rateLimiter.set(ip, { attempts: currentAttempts + 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
            return NextResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 }
            );
        }

        // Reset rate limits on successful login
        rateLimiter.delete(ip);

        // Refuse login for explicitly-deactivated accounts.
        if (user.active === false) {
            return NextResponse.json(
                { error: 'Account is disabled. Contact an administrator.' },
                { status: 403 }
            );
        }

        // Second factor: if the user has TOTP enabled, require a valid code
        // before issuing a session. Frontend pattern: first request fails
        // with mfa_required=true, then re-submits with mfa_code.
        if (user.totp_enabled && user.totp_secret) {
            const { verifyCode } = await import('@/lib/totp');
            const bcryptLib = await import('bcryptjs');
            if (!mfaCode) {
                return NextResponse.json(
                    { error: '2FA required', mfa_required: true },
                    { status: 401 }
                );
            }
            // Try TOTP first
            const step = verifyCode({ secret: user.totp_secret, code: mfaCode });
            let mfaOk = false;
            if (step !== null && step !== user.totp_last_step) {
                mfaOk = true;
                await usersCollection.updateOne(
                    { _id: user._id },
                    { $set: { totp_last_step: step } }
                ).catch(() => undefined);
            } else if (user.totp_backup_codes && user.totp_backup_codes.length > 0) {
                // Try a backup code; if matched, remove it.
                for (let i = 0; i < user.totp_backup_codes.length; i++) {
                    if (await bcryptLib.default.compare(mfaCode, user.totp_backup_codes[i])) {
                        mfaOk = true;
                        const remaining = [...user.totp_backup_codes];
                        remaining.splice(i, 1);
                        await usersCollection.updateOne(
                            { _id: user._id },
                            { $set: { totp_backup_codes: remaining } }
                        ).catch(() => undefined);
                        break;
                    }
                }
            }
            if (!mfaOk) {
                const currentAttempts = rateLimiter.get(ip)?.attempts || 0;
                rateLimiter.set(ip, { attempts: currentAttempts + 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
                return NextResponse.json(
                    { error: 'Invalid 2FA code', mfa_required: true },
                    { status: 401 }
                );
            }
        }

        // Ensure RBAC seeds + migration have run before we resolve permissions.
        await ensureRbacReady();

        const userType = user.type || 'simple';
        const permissions = await computeEffectivePermissions({
            type: userType,
            role_id: user.role_id,
            _id: user._id?.toString(),
        });

        // Return user without password. Include `permissions` so the client
        // can show/hide nav items immediately after login.
        const authUser: AuthUser & { permissions: string[] } = {
            _id: user._id?.toString(),
            name: user.name,
            type: userType,
            role_id: user.role_id,
            active: user.active ?? true,
            permissions,
        };

        // Stamp last login (best-effort)
        usersCollection.updateOne(
            { _id: user._id },
            { $set: { last_login_at: new Date().toISOString() } }
        ).catch(() => { /* ignore */ });

        const jwt = await signSessionToken({
            _id: user._id?.toString(),
            name: user.name,
            type: userType,
            role_id: user.role_id,
            permissions,
            active: user.active ?? true,
        });

        const response = NextResponse.json(authUser);

        // Set HttpOnly cookie
        response.cookies.set('session', jwt, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 // 7 days
        });

        return response;
    } catch (err) {
        console.error('Login error:', err);
        return NextResponse.json(
            { error: 'Login failed' },
            { status: 500 }
        );
    }
}
