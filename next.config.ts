import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  output: "standalone",
  outputFileTracingExcludes: {
    "*": [
      "./app/**/*",
      "./build/**/*",
      "./dist/**/*",
      "./db/**/*",
      "./data/**/*",
      "./drizzle/**/*",
      "./examples/**/*",
      "./lib/**/*",
      "./worker/**/*",
      "./node_modules/@img/**/*",
      "./node_modules/sharp/**/*",
      "./Dockerfile",
      "./README.md",
      "./docker-compose.yml",
      "./drizzle.config.ts",
      "./eslint.config.mjs",
      "./package-lock.json",
      "./tsconfig.json",
      "./vite.config.ts",
    ],
  },
};

export default nextConfig;
