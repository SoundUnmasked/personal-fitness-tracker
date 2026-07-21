import type { Metadata, Viewport } from 'next';
import './globals.css';
import BottomNav from '@/components/BottomNav';
import SWRegister from '@/components/SWRegister';
import SessionBar from '@/components/SessionBar';

export const metadata: Metadata = {
  title: 'Personal Fitness Tracker',
  description: 'Personal health & fitness tracker',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Fitness Tracker',
  },
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#12131a' },
    { media: '(prefers-color-scheme: light)', color: '#f4f5f8' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

// Runs before first paint: apply the saved theme so there is no light/dark flash.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the theme-init script sets data-theme on <html>
    // before hydration; without this React would strip it on client pages.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* No-flash theme: apply the saved theme before first paint. A plain
            inline script in the server-rendered <head> is the sanctioned App
            Router pattern (layout.tsx is a server component). */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* Self-hosted fonts (Geist, Geist Mono, Material Symbols Rounded) so the
            PWA renders correctly offline at the gym — no CDN dependency. */}
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body>
        <main className="app" id="app-shell">{children}</main>
        <SessionBar />
        <BottomNav />
        <SWRegister />
      </body>
    </html>
  );
}
