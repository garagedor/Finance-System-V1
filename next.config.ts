import type { NextConfig } from "next";

/**
 * Warehouse is a separate Next application in its own repository and its own
 * Vercel project. It is reached same-origin at /warehouse/* so that the
 * browser treats it as this site — which is what makes a cookie a usable
 * carrier for its token, and what keeps that cookie scoped to /warehouse.
 *
 * Nothing is merged: no monorepo, no shared build, no Warehouse code here.
 *
 * The destination carries the /warehouse prefix because Warehouse is built
 * with `basePath: "/warehouse"`. Both halves must agree — dropping the prefix
 * on either side resolves its assets against this origin and breaks every
 * page.
 *
 * The prefix is the entire boundary: no other path is rewritten, so Warehouse
 * can never answer for a CRM route, and /api/* here is untouched.
 */
const WAREHOUSE_ORIGIN = "https://lbs-warehouse.vercel.app";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      // :path* does not match the bare prefix, so it needs its own entry.
      { source: "/warehouse", destination: `${WAREHOUSE_ORIGIN}/warehouse` },
      { source: "/warehouse/:path*", destination: `${WAREHOUSE_ORIGIN}/warehouse/:path*` },
    ];
  },
};

export default nextConfig;
