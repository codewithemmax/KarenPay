import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config, { isServer, webpack }) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    config.resolve.modules = [
      ...(config.resolve.modules ?? ["node_modules"]),
      path.resolve(__dirname, "../../packages/core/node_modules"),
    ];
    if (!isServer) {
      const browserCryptoShimPath = path.resolve(
        __dirname,
        "src/lib/browserCryptoShim.ts",
      );
      // The "node:" scheme is rejected before resolve.alias runs, so swap the module itself.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:crypto$/,
          browserCryptoShimPath,
        ),
      );
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        "node:crypto": browserCryptoShimPath,
        crypto: browserCryptoShimPath,
      };
    }
    return config;
  },
};

export default nextConfig;
