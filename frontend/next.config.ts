import type { NextConfig } from "next";

// The browser opens its live-update WebSocket on the app's own origin (/ws), and Next forwards the
// upgrade to the backend, so no extra port has to be published and the auth cookie rides along.
// Evaluated at build time for `next start`: the container image sets BACKEND_ORIGIN accordingly.
const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/ws", destination: `${backendOrigin}/ws` }];
  },
};

export default nextConfig;
