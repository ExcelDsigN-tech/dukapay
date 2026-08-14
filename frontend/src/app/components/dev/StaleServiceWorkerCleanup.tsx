"use client";

import { useEffect } from "react";

/**
 * DEV-ONLY helper: unregisters service workers that were registered on this
 * origin by a different app (e.g. a leftover PWA on localhost:3000). A stale
 * worker can keep intercepting navigations long after the server behind the
 * port changes, so we clear it to guarantee the current app is actually served.
 */
export function StaleServiceWorkerCleanup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    const hasNavigator = typeof navigator !== "undefined" && "serviceWorker" in navigator;
    if (!hasNavigator) {
      return;
    }

    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) {
          void registration.unregister();
        }
        if (registrations.length > 0) {
          // eslint-disable-next-line no-console
          console.info(`[dev] Unregistered ${registrations.length} stale service worker(s).`);
        }
      })
      .catch(() => {
        /* ignore — cleanup is best-effort in dev */
      });
  }, []);

  return null;
}
