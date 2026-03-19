import { charge as charge_ } from './Charge.js'
import { session as session_ } from './Session.js'

/**
 * Creates a Solana `charge` method for usage on the client.
 *
 * Intercepts 402 responses, sends a Solana transaction to pay the challenge,
 * and retries with the transaction signature as credential automatically.
 *
 * @example
 * ```ts
 * import { Mppx, solana } from 'solana-mpp-sdk/client'
 *
 * const method = solana.charge({ signer })
 * const mppx = Mppx.create({ methods: [method] })
 *
 * const response = await mppx.fetch('https://api.example.com/paid-content')
 * ```
 */
export function solana(parameters: solana.Parameters): ReturnType<typeof charge_> {
  return charge_(parameters)
}

export namespace solana {
  export type Parameters = charge_.Parameters

  /** Creates a Solana `charge` method for one-shot on-chain payments. */
  export const charge = charge_
  export const session = session_
}
