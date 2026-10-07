import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { jwtSecret } from '@/lib/jwt-secret';

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
// every real token fails verification and the whole API locks out. Both now go
// through lib/jwt-secret.ts, which has no imports precisely so this file can
// use it on the Edge runtime. Do not import anything else here.


// ── Warehouse: the /warehouse prefix ───────────────────────────────────────
//
// Warehouse is a separate application reached through a same-origin rewrite.
// Two things happen here, and only one of them is security.
//
// 1. REFRESH (convenience, NOT authorization). The Warehouse token lives 15
//    minutes. Rather than ejecting someone mid-task, this reads the `exp` of
//    the wh_token cookie WITHOUT VERIFYING IT and, if it is missing or nearly
//    spent, sends the browser to mint a fresh one. The decoded payload is used
//    for exactly one decision — "redirect or continue" — and never to decide
//    identity, permissions, account type or session validity. A forged cookie
//    claiming a distant expiry buys nothing: it is passed upstream and
//    Warehouse rejects it, because Warehouse verifies the RS256 signature,
//    issuer, audience, expiry, modules, account type, permissions and liveness.
//    This middleware is not a Warehouse authentication authority.
//
// 2. STRIPPING THE CRM SESSION COOKIE (this part is security). Same-origin
//    means the browser attaches the CRM `session` cookie to every /warehouse
//    request, and the proxy would forward it to a different application. That
//    cookie is the central bearer credential for CRM and Finance; Warehouse
//    does not need it and must not receive it. Only that one cookie is
//    removed — wh_token and everything else are passed through untouched.
const WAREHOUSE_PREFIX = '/warehouse';
// Must equal WAREHOUSE_TOKEN_COOKIE in lib/warehouse-mint.ts. Repeated as a
// literal because this file may not import anything that leaves Edge; a test
// pins the two together.
const WAREHOUSE_TOKEN_COOKIE = 'wh_token';
const CRM_SESSION_COOKIE = 'session';
const ENTER_ROUTE = '/api/auth/warehouse-enter';
// UX only. Changing it does not change the 900s token lifetime.
const REFRESH_WHEN_SECONDS_LEFT = 60;

/** Seconds of life left in a token, by DECODING the payload — never verifying.
 *  Returns null when there is nothing usable to read. */
function unverifiedSecondsLeft(token: string | undefined): number | null {
    if (!token) return null;
    try {
        const payload = token.split('.')[1];
        if (!payload) return null;
        const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
        const exp = (JSON.parse(json) as { exp?: unknown }).exp;
        if (typeof exp !== 'number') return null;
        return exp - Math.floor(Date.now() / 1000);
    } catch {
        return null;
    }
}

function handleWarehouse(request: NextRequest) {
    const left = unverifiedSecondsLeft(request.cookies.get(WAREHOUSE_TOKEN_COOKIE)?.value);

    if (left === null || left <= REFRESH_WHEN_SECONDS_LEFT) {
        // No loop is possible: the entry route sets a cookie before it
        // redirects here, and refuses outright when it cannot.
        const enter = new URL(ENTER_ROUTE, request.nextUrl.origin);
        enter.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
        return NextResponse.redirect(enter, 302);
    }

    // Forward everything except the CRM session cookie.
    const headers = new Headers(request.headers);
    const remaining = request.cookies
        .getAll()
        .filter((c) => c.name !== CRM_SESSION_COOKIE)
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
    if (remaining) headers.set('cookie', remaining);
    else headers.delete('cookie');

    return NextResponse.next({ request: { headers } });
}

export async function middleware(request: NextRequest) {
    if (request.nextUrl.pathname.startsWith(WAREHOUSE_PREFIX)) {
        return handleWarehouse(request);
    }

    // Only protect /api routes
    if (!request.nextUrl.pathname.startsWith('/api')) {
        return NextResponse.next();
    }

    // Exempt auth-related routes + the ScanPay webhook (external caller; it
    // authenticates with its own shared secret, not the portal session JWT).
    // NOTE: the Tables AI write doors — '/api/ai-jobs/ingest' (manual/test) and
    // '/api/ai-jobs/jobs' (the closing-dashboard SHADOW outbox: POST /jobs +
    // PUT /jobs/{id}) — are exempt because they authenticate with the
    // AI_INGEST_TOKEN, not the session cookie. Each self-checks that Bearer token
    // and fails CLOSED (503) if it is unset.
    // '/api/internal/auth/session-state' is exempt for the same reason: it is
    // called by Warehouse with a dedicated service credential, never with a
    // session cookie, and it authenticates that credential itself and fails
    // CLOSED (503) when it is unset. The other /api/ai-jobs/* routes
    // (CRUD at '/api/ai-jobs', compare, link) stay JWT-protected — none of them
    // match the '/api/ai-jobs/ingest' or '/api/ai-jobs/jobs' prefixes.
    const exemptRoutes = ['/api/login', '/api/logout', '/api/scanpay/webhook', '/api/scanpay/cron-sync', '/api/cron/job-mirror-resync', '/api/ai-jobs/ingest', '/api/ai-jobs/jobs', '/api/internal/auth/session-state'];
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
        //
        // jwtSecret() throws when JWT_SECRET is unset. That is deliberate: an
        // unconfigured deployment denies every API request rather than falling
        // back to a known string and accepting forged ones. The failure is
        // loud, total and recoverable; the alternative is silent and not.
        await jwtVerify(sessionCookie.value, jwtSecret());
        return NextResponse.next();
    } catch (error) {
        console.error('JWT verification failed:', error);
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
}

// Config to run middleware only on specific paths
export const config = {
    matcher: ['/api/:path*', '/warehouse', '/warehouse/:path*'],
};
