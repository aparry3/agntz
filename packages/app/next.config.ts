import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/system": ["../worker/dist/defaults/**/*"],
    "/system/[id]": ["../worker/dist/defaults/**/*"],
    "/api/system/agents": ["../worker/dist/defaults/**/*"],
    "/api/system/agents/[id]": ["../worker/dist/defaults/**/*"],
  },
  transpilePackages: [
    "@agntz/core",
    "@agntz/manifest",
    "@agntz/worker",
  ],
  serverExternalPackages: [
    "@agntz/store-postgres",
  ],
};

export default nextConfig;
