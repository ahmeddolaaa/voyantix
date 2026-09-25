import type { NextConfig } from "next";

/**
 * Cross-origin allowances for cloud dev environments served behind a proxy
 * (GitHub Codespaces, Google Cloud Shell). Both settings must name the host:
 *  - serverActions.allowedOrigins so POST server actions (login and every
 *    button) are not rejected as cross-origin;
 *  - allowedDevOrigins so dev-only resources (HMR, fonts) load.
 * These are development conveniences only; production is served same-origin.
 */
const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.cloudshell.dev", "*.app.github.dev"],
  experimental: {
    serverActions: {
      allowedOrigins: ["*.app.github.dev", "*.cloudshell.dev", "localhost:3000"],
      // SOF upload: a scanned statement of facts can be several MB (15 MB cap
      // in the action + multipart overhead).
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
