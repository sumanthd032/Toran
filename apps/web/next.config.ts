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
};

export default nextConfig;
