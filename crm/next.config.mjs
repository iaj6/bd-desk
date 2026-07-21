/** @type {import('next').NextConfig} */
const nextConfig = {
  // crm/ is its own npm project inside the repo; pin the workspace root so
  // Turbopack doesn't guess from the repo-level lockfile.
  turbopack: { root: import.meta.dirname },
};
export default nextConfig;
