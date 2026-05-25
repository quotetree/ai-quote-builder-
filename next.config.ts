import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Middleware buffers request bodies (default 10MB); attachments allow up to 20MB.
    proxyClientMaxBodySize: "25mb",
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;

