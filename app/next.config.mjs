/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
