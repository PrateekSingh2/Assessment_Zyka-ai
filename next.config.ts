import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  // -----------------------------------------------------------------
  // SECURITY: Hard cap on buffered request body size (via proxy).
  // 16 KB is intentionally conservative for this AI prompt API.
  // See: node_modules/next/dist/docs/01-app/03-api-reference/05-config/
  //      01-next-config-js/proxyClientMaxBodySize.md
  // -----------------------------------------------------------------
  experimental: {
    proxyClientMaxBodySize: "16kb",
  },

  // -----------------------------------------------------------------
  // SECURITY: Platform-level HTTP security headers applied globally.
  // These complement the Zod/boundary validation in the API layer.
  //
  // CSP: nonces for inline scripts are generated per-request in proxy.ts
  //      following the Next.js CSP guide. img-src/media-src is restricted
  //      to the known CDN hosts used by mock-upstream.ts.
  // -----------------------------------------------------------------
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent MIME-type sniffing
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          // Prevent clickjacking
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          // Minimal referrer leakage
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Prevent browsers from sending the page in plain HTTP
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Disable cross-origin openers that could leak window references
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          // Restrict resource embedding from cross-origin frames
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          // Permissions policy — disable powerful browser features not needed
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // Content-Security-Policy (static fallback; nonce variant in proxy.ts)
          // Restrict img/media to the CDN domains used by mock-upstream + self
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js requires 'unsafe-inline' for its runtime CSS-in-JS
              // in dev; tighten this with nonces in proxy.ts for production.
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              // Allow images from known CDN hosts used by mock-upstream
              [
                "img-src 'self' blob: data:",
                "https://images.unsplash.com",
                "https://commondatastorage.googleapis.com",
              ].join(" "),
              // Allow audio/video from known CDN hosts
              [
                "media-src 'self'",
                "https://commondatastorage.googleapis.com",
                "https://www.soundhelix.com",
              ].join(" "),
              "font-src 'self'",
              "connect-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
      // Remove the X-Powered-By header to avoid fingerprinting
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Powered-By",
            value: "",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
