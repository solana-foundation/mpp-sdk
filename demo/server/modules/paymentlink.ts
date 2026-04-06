/**
 * Payment Link demo module.
 *
 * Demonstrates browser-based payment links: navigate to the endpoint in a
 * browser and you'll see an interactive payment page instead of raw JSON.
 *
 * - GET /api/v1/fortune        → browser: HTML payment page, API client: 402 JSON
 * - GET /api/v1/fortune?__mpp_worker → service worker JS
 */

import type { Express, Request, Response as ExpressResponse } from 'express'
import type { KeyPairSigner } from '@solana/kit'
import { Mppx, solana, html } from '../sdk.js'
import { toWebRequest, logPayment } from '../utils.js'
import { USDC_MINT, USDC_DECIMALS } from '../constants.js'

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

/** Parse the WWW-Authenticate header into a challenge object. */
function parseWWWAuthenticate(header: string): Record<string, string> {
  const result: Record<string, string> = {}
  const params = header.replace(/^Payment\s+/i, '')
  const regex = /(\w+)="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(params)) !== null) {
    result[match[1]] = match[2]
  }
  return result
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
    // Serve the service worker JS
    if (html.isServiceWorkerRequest(req.originalUrl)) {
      res.setHeader('Content-Type', 'application/javascript')
      res.setHeader('Service-Worker-Allowed', '/')
      res.send(html.serviceWorkerJs())
      return
    }

    const result = await mppx.charge({
      amount: '10000', // 0.01 USDC (6 decimals)
      currency: USDC_MINT,
      description: 'Open a fortune cookie',
    })(toWebRequest(req))

    if (result.status === 402) {
      const challenge = result.challenge as globalThis.Response

      // Browser request → HTML payment page (using @solana/mpp html module)
      if (html.acceptsHtml(req.headers.accept)) {
        const wwwAuth = challenge.headers.get('WWW-Authenticate') ?? ''
        const parsed = parseWWWAuthenticate(wwwAuth)
        const response = html.respondWithPaymentPage({
          challenge: parsed as any,
          network,
          rpcUrl,
          wwwAuthenticate: wwwAuth,
        })
        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(await response.text())
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
