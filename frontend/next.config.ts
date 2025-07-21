// import type { NextConfig } from "next";

// const nextConfig: NextConfig = {
//   webpack: config => {
//     config.externals.push('pino-pretty', 'lokijs', 'encoding')
//     return config
//   }
// };

// export default nextConfig;


import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: "standalone",
  images: {
    formats: ["image/webp"],
    domains: [], // add your image CDN domains if needed
  },
  experimental: {
    optimizeCss: true,
    scrollRestoration: true,
  },
  webpack: (config, { isServer }) => {
    // Avoid bundling large server-only packages into client
    if (!isServer) {
      config.externals.push("pino-pretty", "lokijs", "encoding");
    }

    return config;
  },
};

export default bundleAnalyzer(nextConfig);
