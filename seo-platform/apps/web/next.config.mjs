/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Панель ходит в API только на сервере: браузер не должен знать адрес
  // внутреннего сервиса и тем более получать доступ к контуру UNA напрямую.
  env: { API_URL: process.env.API_URL ?? 'http://localhost:3000' },
};

export default nextConfig;
