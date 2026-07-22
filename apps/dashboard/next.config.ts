import type { NextConfig } from "next";

const internalApiUrl = (process.env.SIGNALPILOT_API_INTERNAL_URL ?? "http://localhost:3100").replace(
  /\/+$/,
  ""
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${internalApiUrl}/:path*`
      }
    ];
  }
};

export default nextConfig;
