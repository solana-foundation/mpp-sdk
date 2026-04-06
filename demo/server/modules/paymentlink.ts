/**
 * Payment Link demo module.
 *
 * Demonstrates browser-based payment links: navigate to the endpoint in a
 * browser and you'll see an interactive payment page instead of raw JSON.
 *
 * - GET /api/v1/fortune        → browser: HTML payment page, API client: 402 JSON
 * - GET /api/v1/fortune?__mpp_worker → service worker JS
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Express, Request, Response as ExpressResponse } from 'express'
import type { KeyPairSigner } from '@solana/kit'
import { Mppx, solana } from '../sdk.js'
import { toWebRequest, logPayment } from '../utils.js'
import { USDC_MINT, USDC_DECIMALS } from '../constants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load the bundled JS assets from the shared html/ build output.
const HTML_ROOT = resolve(__dirname, '../../../html/dist')
let paymentUIJS: string
let serviceWorkerJS: string
try {
  paymentUIJS = readFileSync(resolve(HTML_ROOT, 'payment-ui.js'), 'utf-8')
  serviceWorkerJS = readFileSync(resolve(HTML_ROOT, 'service-worker.js'), 'utf-8')
} catch {
  console.warn('Payment link assets not found. Run `just html-build` first.')
  paymentUIJS = '/* payment-ui.js not built */'
  serviceWorkerJS = '/* service-worker.js not built */'
}

const DATA_ELEMENT_ID = '__MPP_DATA__'
const SERVICE_WORKER_PARAM = '__mpp_worker'

const FORTUNES = [
  'A beautiful, smart, and loving person will be coming into your life.',
  'A dubious friend may be an enemy in camouflage.',
  'A faithful friend is a strong defense.',
  'A fresh start will put you on your way.',
  'A golden egg of opportunity falls into your lap this month.',
  'A good time to finish up old tasks.',
  'A light heart carries you through all the hard times.',
  'A smooth long journey! Great expectations.',
  'All your hard work will soon pay off.',
  'An important person will offer you support.',
  'Be careful or you could fall for some tricks today.',
  'Believe in yourself and others will too.',
  'Curiosity kills boredom. Nothing can kill curiosity.',
  'Disbelief destroys the magic.',
  'Every day in your life is a special occasion.',
  'Failure is the chance to do better next time.',
  'Go take a rest; you deserve it.',
  'Good news will come to you by mail.',
  'He who laughs at himself never runs out of things to laugh at.',
  'If you continually give, you will continually have.',
]

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function acceptsHtml(req: Request): boolean {
  const accept = req.headers.accept ?? ''
  return accept.includes('text/html')
}

/** Parse the WWW-Authenticate header into a challenge object. */
function parseWWWAuthenticate(header: string): Record<string, string> {
  const result: Record<string, string> = {}
  // Strip "Payment " prefix
  const params = header.replace(/^Payment\s+/i, '')
  // Match key="value" pairs
  const regex = /(\w+)="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(params)) !== null) {
    result[match[1]] = match[2]
  }
  return result
}

function buildPaymentHTML(challenge: Record<string, string>, network: string, rpcUrl: string): string {
  const challengeJson = JSON.stringify(challenge, null, 2)
  const testMode = network === 'devnet' || network === 'localnet'

  const embeddedData = JSON.stringify({
    challenge,
    network,
    rpcUrl,
    testMode,
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payment Required</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; background: #f7fafc; color: #1a202c; }
pre { background: #edf2f7; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; max-width: 600px; margin: 20px auto; }
</style>
</head>
<body>
<details style="max-width:600px;margin:0 auto 20px">
<summary style="cursor:pointer;color:#718096;font-size:14px">Challenge details</summary>
<pre>${escapeHtml(challengeJson)}</pre>
</details>
<div id="root"></div>
<script type="application/json" id="${DATA_ELEMENT_ID}">${embeddedData}</script>
<script>${paymentUIJS}</script>
</body>
</html>`
}

export function registerPaymentLink(
  app: Express,
  recipient: string,
  network: string,
  secretKey: string,
  feePayerSigner: KeyPairSigner,
) {
  const rpcUrl = network === 'localnet' || network === 'devnet'
    ? 'http://localhost:8899'
    : 'https://api.mainnet-beta.solana.com'

  const mppx = Mppx.create({
    secretKey,
    methods: [solana.charge({
      recipient,
      network,
      signer: feePayerSigner,
      currency: USDC_MINT,
      decimals: USDC_DECIMALS,
    })],
  })

  app.get('/api/v1/fortune', async (req: Request, res: ExpressResponse) => {
    // Serve the service worker JS when requested
    if (req.query[SERVICE_WORKER_PARAM] !== undefined) {
      res.setHeader('Content-Type', 'application/javascript')
      res.setHeader('Service-Worker-Allowed', '/')
      res.send(serviceWorkerJS)
      return
    }

    const result = await mppx.charge({
      amount: '10000', // 0.01 USDC (6 decimals)
      currency: USDC_MINT,
      description: 'Open a fortune cookie',
    })(toWebRequest(req))

    if (result.status === 402) {
      const challenge = result.challenge as globalThis.Response

      // Browser request → HTML payment page
      if (acceptsHtml(req)) {
        const wwwAuth = challenge.headers.get('WWW-Authenticate') ?? ''
        const parsed = parseWWWAuthenticate(wwwAuth)
        const html = buildPaymentHTML(parsed, network, rpcUrl)
        res.status(402)
        res.setHeader('Content-Type', 'text/html')
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src *; worker-src 'self'")
        res.setHeader('WWW-Authenticate', wwwAuth)
        res.setHeader('Cache-Control', 'no-store')
        res.send(html)
        return
      }

      // API client → standard 402 JSON
      res.writeHead(challenge.status, Object.fromEntries(challenge.headers))
      res.end(await challenge.text())
      return
    }

    // Payment succeeded — return a fortune
    const fortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)]
    const response = result.withReceipt(
      globalThis.Response.json({ fortune }),
    ) as globalThis.Response
    logPayment(req.path, response)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(await response.text())
  })
}
