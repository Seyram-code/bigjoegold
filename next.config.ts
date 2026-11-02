import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [{
      source: "/:path*",
      has: [{ type: "host", value: "www.bigjoegold.com" }],
      destination: "https://bigjoegold.com/:path*",
      permanent: true,
    }];
  },
};

export default nextConfig;
