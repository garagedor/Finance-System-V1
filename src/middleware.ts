import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// MUST resolve the secret exactly like the signer (src/lib/rbac.ts) — otherwise
// every real token fails verification and the whole API locks out.
const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET ?? 'super-secret-key-for-development'
);

export async function middleware(request: NextRequest) {
    // Only protect /api routes
    if (!request.nextUrl.pathname.startsWith('/api')) {
        return NextResponse.next();
    }

    // Exempt auth-related routes
    const exemptRoutes = ['/api/login', '/api/logout'];
    if (exemptRoutes.some(route => request.nextUrl.pathname.startsWith(route))) {
        return NextResponse.next();
    }

    const sessionCookie = request.cookies.get('session');

    if (!sessionCookie || !sessionCookie.value) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Actually verify the signature + expiry (previously this only checked
        // the cookie was present, so any non-empty value passed).
        await jwtVerify(sessionCookie.value, JWT_SECRET);
        return NextResponse.next();
    } catch (error) {
        console.error('JWT verification failed:', error);
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
}

// Config to run middleware only on specific paths
export const config = {
    matcher: ['/api/:path*'],
};
