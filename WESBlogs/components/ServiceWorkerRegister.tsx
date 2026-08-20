'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Service worker registration is optional and must not affect page rendering.
    });
  }, []);

  return null;
}
