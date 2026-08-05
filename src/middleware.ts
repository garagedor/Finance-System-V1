import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// SECURITY NOTE (perf review, Phase 10): this middleware verifies the session
// JWT on every /api/* request and returns 401 when it's missing/invalid. Routes
// ALSO verify (via readSession/requirePermission) to enforce PERMISSIONS (403).
// That looks like a duplicate verify, but it is intentional defense-in-depth:
// the middleware is the ONLY auth gate protecting any legacy API route that does
// not self-check. It must NOT be removed to "save a verify" — doing so would
// expose those routes. The per-route check adds authorization on top. If the
// double signature-verify is ever eliminated, every /api route must first be
// proven to enforce its own auth. (Next 16 renames this convention to `proxy`;
// migrating is cosmetic and should be validated against real auth flows.)

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

    // Exempt auth-related routes + the ScanPay webhook (external caller; it
    // authenticates with its own shared secret, not the portal session JWT).
    const exemptRoutes = ['/api/login', '/api/logout', '/api/scanpay/webhook'];
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
