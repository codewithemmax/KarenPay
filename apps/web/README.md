# KarenPay web client

The Next.js voice client integrates with the Express API using **Option A (Same-Origin Rewrite Proxy)** so `kp_session` and `kp_auth_ceremony` cookies remain first-party (`SameSite=Strict; HttpOnly; Secure; Path=/api/v1`) across mobile browsers (including iOS Safari and Android Chrome).

## Next.js Rewrite Configuration (`next.config.mjs`)

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiOrigin = process.env.API_INTERNAL_ORIGIN ?? "http://localhost:3001";
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
```
