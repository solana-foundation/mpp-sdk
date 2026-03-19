import { charge as charge_ } from './Charge.js'
import { session as session_ } from './Session.js'

/**
 * Creates Solana payment methods for usage on the server.
 *
 * @example
 * ```ts
 * import { Mppx, solana } from 'solana-mpp-sdk/server'
 *
 * const mppx = Mppx.create({
 *   methods: [solana.charge({ recipient: '...', network: 'devnet' })],
 * })
 * ```
 */
export function solana(parameters: solana.Parameters): ReturnType<typeof charge_> {
  return solana.charge(parameters)
}

export namespace solana {
  export type Parameters = charge_.Parameters

  /** Creates a Solana `charge` method for one-shot on-chain payments (SOL or SPL tokens). */
  export const charge = charge_
  export const session = session_
}
