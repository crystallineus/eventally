import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    serverActions: {
      // Photos are resized in the browser first; this stays under Vercel's ~4.5 MB request cap.
      bodySizeLimit: "4.5mb",
      // In a Codespace, VS Code forwards localhost:3000 to the app while the proxy sets
      // x-forwarded-host to *.app.github.dev, which trips the Server Actions CSRF check.
      ...(process.env.NODE_ENV === "development" && { allowedOrigins: ["localhost:3000"] }),
    },
  },
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
