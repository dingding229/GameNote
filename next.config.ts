import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  output: "standalone",
  outputFileTracingExcludes: {
    "*": [
      "./app/**/*",
      "./data/**/*",
      "./lib/**/*",
      "./node_modules/@img/**/*",
      "./node_modules/sharp/**/*",
      "./Dockerfile",
      "./docker-compose.yml",
      "./package-lock.json",
      "./tsconfig.json",
    ],
  },
};

export default nextConfig;
