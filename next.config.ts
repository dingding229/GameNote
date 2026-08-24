import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  images: {
    unoptimized: true,
  },
  output: "standalone",
};

export default nextConfig;
