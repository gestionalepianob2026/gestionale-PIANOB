import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Consente l'accesso al server di sviluppo anche dagli IP di rete locale
  // (es. dal telefono sulla stessa Wi-Fi). Necessario in dev per caricare il JS.
  allowedDevOrigins: [
    "192.168.1.111",
    "192.168.56.1",
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
