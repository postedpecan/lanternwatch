import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep development HMR artifacts separate from production builds. Running
  // `next build` while the local dashboard is open can otherwise mix an older
  // server-rendered document with newer client chunks and trigger hydration
  // attribute mismatches.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};

export default nextConfig;
