/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

/**
 * One-shot service worker for MPP payment links.
 *
 * Flow:
 * 1. Client sends credential via postMessage after wallet signing
 * 2. Worker intercepts the next navigate fetch, attaches Authorization header
 * 3. Worker immediately unregisters itself
 */

let pendingCredential: string | null = null;

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const { credential } = event.data ?? {};
  if (typeof credential === 'string') {
    pendingCredential = credential;
    // Acknowledge receipt to the client
    event.ports[0]?.postMessage({ received: true });
  }
});

self.addEventListener('fetch', (event: FetchEvent) => {
  if (!pendingCredential) return;
  if (event.request.mode !== 'navigate') return;

  const credential = pendingCredential;
  pendingCredential = null;

  event.respondWith(
    (async () => {
      const headers = new Headers(event.request.headers);
      headers.set('Authorization', `Payment ${credential}`);

      const modifiedRequest = new Request(event.request, { headers });
      const response = await fetch(modifiedRequest);

      // Unregister after successful interception
      self.registration.unregister();

      return response;
    })(),
  );
});

// Activate immediately, don't wait for existing clients
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
