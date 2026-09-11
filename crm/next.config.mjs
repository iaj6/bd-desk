/** @type {import('next').NextConfig} */
const nextConfig = {
  // crm/ is its own npm project inside the repo; pin the workspace root so
  // Turbopack doesn't guess from the repo-level lockfile.
  turbopack: { root: import.meta.dirname },
  // Nothing here uses next/image, so turn the Image Optimization endpoint off entirely
  // rather than ship an unused, CVE-prone surface. (Also gated in proxy.ts.)
  images: { unoptimized: true },
};
export default nextConfig;
