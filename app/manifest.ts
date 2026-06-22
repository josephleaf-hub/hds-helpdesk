import type { MetadataRoute } from 'next';

const APP_ICON = 'https://cdn.prod.website-files.com/69d48f8e8f01871806e7f5c4/6a3381fcf9e5913feceb1d64_It%20SUpport%20App-favicon.png';

// Web app manifest — gives Android/Chrome a home-screen icon + install metadata.
// (iOS uses the apple-touch-icon in app/layout.tsx instead.)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HDS IT Helpdesk',
    short_name: 'HDS Helpdesk',
    description: 'Submit and track HDS IT support tickets.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F4F6F8',
    theme_color: '#060D18',
    icons: [
      { src: APP_ICON, sizes: '192x192', type: 'image/png' },
      { src: APP_ICON, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
