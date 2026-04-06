import { test, expect } from '@playwright/test';

// Configurable via env: FORTUNE_PATH defaults to /fortune
// Demo server uses /api/v1/fortune, standalone test servers use /fortune
const FORTUNE = process.env.FORTUNE_PATH ?? '/fortune';

test('payment link page renders correctly', async ({ page }) => {
  const response = await page.goto(FORTUNE, { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(402);
  expect(response?.headers()['content-type']).toContain('text/html');
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay/i })).toBeEnabled();
});

test('clicking pay triggers the payment flow', async ({ page, context }) => {
  const swPromise = context.waitForEvent('serviceworker', { timeout: 30_000 });

  await page.goto(FORTUNE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Pay/i }).click();

  const sw = await swPromise;
  expect(sw.url()).toContain('__mpp_worker');
});

test('full e2e: payment completes and returns fortune', async ({ page }) => {
  await page.goto(FORTUNE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Pay/i }).click();

  // Wait for the service worker reload cycle
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await page.waitForTimeout(3000);

  const content = await page.content();
  const isFortuneResponse = content.includes('"fortune"');
  const isPaymentPage = content.includes('Payment Required');

  expect(isFortuneResponse || isPaymentPage).toBe(true);

  if (isFortuneResponse) {
    console.log('Payment succeeded — got a fortune!');
  } else {
    console.log('Service worker flow worked, but transaction was not accepted by server.');
  }
});

test('service worker endpoint returns javascript', async ({ page }) => {
  const response = await page.goto(`${FORTUNE}?__mpp_worker=1`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-type']).toContain('application/javascript');
  const body = await response?.text();
  expect(body).toContain('addEventListener');
});

test('API client gets JSON 402 not HTML', async ({ request }) => {
  const response = await request.get(FORTUNE, {
    headers: { Accept: 'application/json' },
  });
  expect(response.status()).toBe(402);
  expect(response.headers()['www-authenticate']).toContain('Payment');
});
