'use client';

import { useEffect } from 'react';

/** Registers the service worker so the app is installable / works offline. */
export default function SWRegister() {
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      process.env.NODE_ENV !== 'production'
    ) {
      // Only register in production — avoids caching dev assets.
      return;
    }
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  }, []);
  return null;
}
