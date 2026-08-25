import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry } from "@serwist/precaching";
import { Serwist } from "serwist";

declare const self: WorkerGlobalScope & {
  __SW_MANIFEST: PrecacheEntry[];
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  bypassCdn: ({ request }: { request: Request }) => {
    if (
      request.url.includes("/api/") ||
      request.url.includes("/sse/") ||
      request.url.includes("/_next/")
    ) {
      return true;
    }
    return false;
  },
} as ConstructorParameters<typeof Serwist>[0] & {
  bypassCdn: (context: { request: Request }) => boolean;
});

serwist.addEventListeners();

// Background sync: process queued repayments when connectivity is restored
self.addEventListener("sync", (event: any) => {
  if (event.tag !== "sync-repayments") return;

  event.waitUntil((async () => {
    try {
      // Open the same IndexedDB used by the client queue
      const DB_NAME = "dukapay-offline-queue";
      const STORE = "repayments";

      const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const db = await openDb();
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const allReq = store.getAll();
      const items: any[] = await new Promise((res, rej) => {
        allReq.onsuccess = () => res(allReq.result as any[]);
        allReq.onerror = () => rej(allReq.error);
      });

      for (const item of items) {
        try {
          // Submit to server endpoint
          await fetch(`/loans/${item.loanId}/repay`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount: item.amount }),
            credentials: "same-origin",
          });

          // Remove from queue on success
          await new Promise<void>((resolve, reject) => {
            const delReq = store.delete(item.id);
            delReq.onsuccess = () => resolve();
            delReq.onerror = () => reject(delReq.error);
          });
        } catch (e) {
          // If any item fails, leave it in the store and continue with others
          // eslint-disable-next-line no-console
          console.error("Failed to submit queued repayment", item, e);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Background sync processing failed:", err);
    }
  })());
});
