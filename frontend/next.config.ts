import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'auth.skyupnews.com',
    'skyupnews.com',
    '*.skyupnews.com',
    '54.167.225.63',
    '54.167.225.63:3100',
    'ec2-54-167-225-63.compute-1.amazonaws.com',
    'ec2-54-167-225-63.compute-1.amazonaws.com:3100',
    '192.168.1.6',
    'localhost:3000',
    '127.0.0.1:3000',
    'localhost:3100',
    '127.0.0.1:3100'
  ],
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
