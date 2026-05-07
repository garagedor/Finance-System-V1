import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, Collection } from 'mongodb';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import type { User, AuthUser } from '../../../types/user';

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const USERS_COLLECTION = 'users';

const JWT_SECRET = new TextEncoder().encode('super-secret-key-for-development');

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

        let { name, password } = await req.json();
        name = name?.trim();

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

        // Return user without password
        const authUser: AuthUser = {
            _id: user._id?.toString(),
            name: user.name,
            type: user.type || 'simple',
        };

        // Create JWT
        const alg = 'HS256';
        const jwt = await new SignJWT({ ...authUser })
            .setProtectedHeader({ alg })
            .setIssuedAt()
            .setExpirationTime('7d')
            .sign(JWT_SECRET);

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
