// import type { NextConfig } from "next";

// const nextConfig: NextConfig = {
//   webpack: config => {
//     config.externals.push('pino-pretty', 'lokijs', 'encoding')
//     return config
//   }
// };

// export default nextConfig;


import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Remove output: 'export' to allow dynamic routes

  // Enable compression
  compress: true,

  // Disable source maps in production to reduce size
  productionBrowserSourceMaps: false,

  // Optimize images
  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 60,
  },

  // Experimental optimizations
  experimental: {
    // Optimize CSS
    optimizeCss: true,

    // Optimize specific package imports
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      '@heroicons/react',
      'react-icons'
    ],
  },

  webpack: (config, { isServer, dev }) => {
    // Your existing externals
    config.externals.push('pino-pretty', 'lokijs', 'encoding');

    // Additional optimizations
    if (!isServer) {
      // Reduce client bundle size
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
      };
    }

    // Enable tree shaking
    config.optimization.usedExports = true;

    // Optimize chunk splitting
    if (!dev) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
            enforce: true,
          },
          common: {
            name: 'common',
            minChunks: 2,
            chunks: 'all',
            enforce: true,
          },
        },
      };
    }

    return config;
  },
};

export default nextConfig;