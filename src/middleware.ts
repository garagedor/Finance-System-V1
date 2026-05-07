import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode('super-secret-key-for-development');

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
