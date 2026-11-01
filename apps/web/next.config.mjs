import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config, { isServer }) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    config.resolve.modules = [
      ...(config.resolve.modules ?? ["node_modules"]),
      path.resolve(__dirname, "../../packages/core/node_modules"),
    ];
    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        "node:crypto": path.resolve(
          __dirname,
          "src/lib/browserCryptoShim.ts",
        ),
      };
    }
    return config;
  },
};

export default nextConfig;
