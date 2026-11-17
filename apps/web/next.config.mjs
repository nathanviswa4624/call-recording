import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone server bundle for production (Ubuntu, systemd). Windows dev hosts cannot create the
  // symlinks pnpm's layout needs without Developer Mode, so it is opt-in there (FORCE_STANDALONE=1).
  output: process.platform !== 'win32' || process.env.FORCE_STANDALONE === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: path.join(dir, '../../'),
  transpilePackages: ['@echelons/shared'],
  poweredByHeader: false,
  reactStrictMode: true,
  // Development only: in production nginx routes /api to the backend (deploy/nginx/echelons.conf).
  async rewrites() {
    return process.env.NODE_ENV === 'production' ? [] : [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};
export default nextConfig;
