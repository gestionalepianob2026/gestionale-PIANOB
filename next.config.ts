import type { NextConfig } from "next";
import path from "node:path";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // Radice esplicita: evita che Next scambi per radice una cartella superiore
  // che contiene un altro package-lock.json (e non trovi le dipendenze).
  turbopack: { root: path.resolve(__dirname) },
  // Non rivelare lo stack tecnologico nell'header X-Powered-By.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Consente l'accesso al server di sviluppo anche dagli IP di rete locale
  // (es. dal telefono sulla stessa Wi-Fi). Necessario in dev per caricare il JS.
  allowedDevOrigins: [
    "192.168.1.111",
    "192.168.56.1",
    "localhost",
    "127.0.0.1",
    "dog-necklace-orleans-accurately.trycloudflare.com",
  ],
};

export default nextConfig;
