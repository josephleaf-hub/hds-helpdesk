import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { ConfirmProvider } from '@/components/Confirm';
import { LightboxProvider } from '@/components/Lightbox';

const APP_ICON = 'https://cdn.prod.website-files.com/69d48f8e8f01871806e7f5c4/6a3381fcf9e5913feceb1d64_It%20SUpport%20App-favicon.png';

export const metadata: Metadata = {
  title: 'IT Helpdesk — HDS',
  icons: {
    icon: APP_ICON,
    shortcut: APP_ICON,
    apple: APP_ICON, // iOS "Add to Home Screen" icon
  },
  // Nicer standalone launch when added to an iOS home screen.
  appleWebApp: {
    capable: true,
    title: 'HDS Helpdesk',
    statusBarStyle: 'default',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body><ToastProvider><ConfirmProvider><LightboxProvider>{children}</LightboxProvider></ConfirmProvider></ToastProvider></body>
    </html>
  );
}
