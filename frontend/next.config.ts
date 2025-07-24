import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  compress: true,
  webpack: config => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding')
    config.optimization.splitChunks = {
      chunks: 'all',
      maxSize: 240 * 1024,
      minSize: 20 * 1024,
    }
    config.cache = false
    return config
  }
};

export default nextConfig;
