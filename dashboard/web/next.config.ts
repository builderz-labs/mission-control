import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack doesn't pick up the parent
  // monorepo's pnpm-lock.yaml and pull Mission Control sources into
  // the dashboard build.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
