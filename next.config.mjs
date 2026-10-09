/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', 'exceljs', 'bcryptjs'],
  poweredByHeader: false,
};
export default nextConfig;
