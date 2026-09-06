import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.app.github.dev"],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "refactored-train-4q7rj5pjjx49379gr-3000.app.github.dev",
        "localhost:3000",
      ],
    },
  },
};

export default nextConfig;