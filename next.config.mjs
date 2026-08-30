/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El typecheck (tsc) sigue corriendo en CI; evitamos que un warning de lint
  // rompa el build de producción.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
