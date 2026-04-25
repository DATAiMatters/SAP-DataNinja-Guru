import type { NextConfig } from "next";
import { resolve } from "node:path";

// The viewer reads curated YAML from the repo root (../domains, ../clusters.yaml,
// ../schema.json). These live outside /web/, so they must be explicitly traced
// into the production server bundle.
const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: resolve(process.cwd(), ".."),
  outputFileTracingIncludes: {
    "/**/*": ["../domains/**/*.yaml", "../clusters.yaml", "../schema.json"],
  },
};

export default config;
