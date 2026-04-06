import { SERVICE_WORKER_PARAM } from './config';

/**
 * Registers the service worker, sends the credential, and reloads the page.
 * The service worker will intercept the reload and attach the Authorization header.
 */
export async function submitViaServiceWorker(credential: string): Promise<void> {
  // Build the service worker URL from current location
  const url = new URL(window.location.href);
  url.searchParams.set(SERVICE_WORKER_PARAM, '1');

  // Register with scope '/' — the server must set `Service-Worker-Allowed: /`
  // on the service worker response for this to work. The worker self-unregisters
  // after one interception, so the broad scope is safe.
  const registration = await navigator.serviceWorker.register(url.toString(), {
    scope: '/',
  });

  // Wait for the worker to be ready
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) throw new Error('Service worker not available');

  await new Promise<void>((resolve) => {
    if (worker.state === 'activated') {
      resolve();
      return;
    }
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve();
    });
  });

  // Send the credential to the worker via MessageChannel
  const activeWorker = registration.active;
  if (!activeWorker) throw new Error('Service worker not active');

  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      if (event.data?.received) resolve();
      else reject(new Error('Service worker did not acknowledge credential'));
    };
    activeWorker.postMessage({ credential }, [channel.port2]);
  });

  // Reload — the service worker will intercept this navigation
  window.location.reload();
}
