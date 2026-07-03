/** @type {import('next').NextConfig} */
const nextConfig = {
  // Service worker + manifest are served as static files from /public.
  // We add headers so the SW can control the whole scope and isn't cached stale.
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
