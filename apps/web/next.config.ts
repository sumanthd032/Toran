import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static export. No server process runs in a memorial hall.
  output: 'export',
  // next/image optimisation needs a server, which we do not have.
  images: { unoptimized: true },
  // Emits directory-style routes so a plain static host resolves them.
  trailingSlash: true,
  reactStrictMode: true,
  // Workspace package ships raw TypeScript.
  transpilePackages: ['@toran/contracts'],
  // `next dev` and `next build` both write .next, so a build run while the dev
  // server is open overwrites the files it is serving. Builds that must not
  // disturb a running dev server set TORAN_BUILD_DIR.
  distDir: process.env.TORAN_BUILD_DIR ?? '.next',
};

export default nextConfig;
