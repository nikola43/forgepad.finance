import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  webpack: (config, { isServer }) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    // config.optimization.splitChunks = {
    //   chunks: 'all',
    //   maxSize: 244 * 1024,
    //   minSize: 20 * 1024
    // }
    config.optimization.splitChunks = {
      chunks: 'all',
      maxSize: 200 * 1024, // Reduced from 244KB
      minSize: 20 * 1024,
      maxAsyncRequests: 30,
      maxInitialRequests: 25,
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          maxSize: 200 * 1024,
        },
        common: {
          name: 'common',
          minChunks: 2,
          chunks: 'all',
          maxSize: 200 * 1024,
        }
      }
    };

    if (!isServer && process.env.NODE_ENV === 'production') {
      config.cache = false;
    }
    return config
  }
};

export default nextConfig;
