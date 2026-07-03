import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  compress: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer }) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');

    // Ignore React Native modules in browser build
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
      // @wagmi/core's unused "tempo" connectors barrel imports an
      // unresolvable 'accounts' module; the app uses explicit adapters, so stub it.
      accounts: false,
    };

    // config.optimization.splitChunks = {
    //   chunks: 'all',
    //   maxSize: 244 * 1024,
    //   minSize: 20 * 1024
    // }
    config.optimization.splitChunks = {
      chunks: 'all',
      maxSize: 200 * 1024,
      minSize: 20 * 1024,
    }
    config.cache = false
    return config
  }
};

export default nextConfig;
