import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // In a Codespace, VS Code forwards localhost:3000 to the app while the proxy sets
  // x-forwarded-host to *.app.github.dev, which trips the Server Actions CSRF check.
  ...(process.env.NODE_ENV === "development" && {
    experimental: { serverActions: { allowedOrigins: ["localhost:3000"] } },
  }),
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
