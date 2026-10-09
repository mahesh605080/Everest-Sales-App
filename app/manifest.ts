import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Everest SFA', short_name: 'Everest SFA', description: 'Sales force monitoring and control for Everest Parenterals',
    start_url: '/dashboard', display: 'standalone', background_color: '#F6F8FC', theme_color: '#1C5CAB',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
  };
}
