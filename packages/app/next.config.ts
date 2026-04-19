import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: [
    "@agntz/core",
    "@agntz/manifest",
  ],
  serverExternalPackages: [
    "@agntz/store-postgres",
  ],
};

export default nextConfig;
