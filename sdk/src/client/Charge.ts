import { Credential, Method } from 'mppx'
import {
  createSolanaRpc,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  partiallySignTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  address,
  AccountRole,
  type TransactionSigner,
  type Instruction,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  getTransferCheckedInstruction,
  findAssociatedTokenPda,
} from '@solana-program/token'
import * as Methods from '../Methods.js'
import {
  TOKEN_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  DEFAULT_RPC_URLS,
} from '../constants.js'

/**
 * Creates a Solana `charge` method for usage on the client.
 *
 * Supports two modes controlled by the `broadcast` option:
 *
 * - **`broadcast: false`** (default, server-broadcast): Signs the transaction
 *   and sends the serialized bytes as a `type="transaction"` credential.
 *   The server broadcasts it to the Solana network.
 *
 * - **`broadcast: true`** (client-broadcast): Signs, broadcasts, confirms
 *   the transaction on-chain, and sends the signature as a `type="signature"`
 *   credential. Cannot be used with server fee sponsorship.
 *
 * When the server advertises `feePayer: true` in the challenge, the client
 * sets the server's `feePayerKey` as the transaction fee payer and partially
 * signs (transfer authority only). The server adds its fee payer signature
 * before broadcasting.
 *
 * @example
 * ```ts
 * import { Mppx, solana } from 'solana-mpp-sdk/client'
 *
 * const method = solana.charge({ signer, rpcUrl: 'https://api.devnet.solana.com' })
 * const mppx = Mppx.create({ methods: [method] })
 *
 * const response = await mppx.fetch('https://api.example.com/paid-content')
 * console.log(await response.json())
 * ```
 */
export function charge(parameters: charge.Parameters) {
  const { signer, broadcast = false, onProgress } = parameters

  const method = Method.toClient(Methods.charge, {
    async createCredential({ challenge }) {
      const { amount, currency, recipient, methodDetails } = challenge.request
      const {
        network,
        splToken,
        decimals,
        tokenProgram: tokenProgramAddr,
        feePayer: serverPaysFees,
        feePayerKey,
      } = methodDetails

      const rpcUrl =
        parameters.rpcUrl ??
        DEFAULT_RPC_URLS[network || 'mainnet-beta'] ??
        DEFAULT_RPC_URLS['mainnet-beta']
      const rpc = createSolanaRpc(rpcUrl)
      onProgress?.({
        type: 'challenge',
        recipient,
        amount,
        currency: currency || (splToken ? 'token' : 'SOL'),
        splToken: splToken || undefined,
        feePayerKey: feePayerKey || undefined,
      })

      // Build transfer instructions.
      const instructions: Instruction[] = []

      if (splToken) {
        // ── SPL token transfer ──
        const mint = address(splToken)
        const tokenProg = address(tokenProgramAddr || TOKEN_PROGRAM)

        const [sourceAta] = await findAssociatedTokenPda({
          owner: signer.address,
          mint,
          tokenProgram: tokenProg,
        })

        const [destAta] = await findAssociatedTokenPda({
          owner: address(recipient),
          mint,
          tokenProgram: tokenProg,
        })

        // Create destination ATA if it doesn't exist (idempotent).
        instructions.push(
          createAssociatedTokenAccountIdempotent(
            signer,
            address(recipient),
            mint,
            destAta,
            tokenProg,
          ),
        )

        instructions.push(
          getTransferCheckedInstruction(
            {
              source: sourceAta,
              mint,
              destination: destAta,
              authority: signer,
              amount: BigInt(amount),
              decimals: decimals ?? 6,
            },
            { programAddress: tokenProg },
          ),
        )
      } else {
        // ── Native SOL transfer ──
        instructions.push(
          getTransferSolInstruction({
            source: signer,
            destination: address(recipient),
            amount: BigInt(amount),
          }),
        )
      }

      onProgress?.({ type: 'signing' })

      // Build and sign the transaction.
      const { value: latestBlockhash } = await rpc
        .getLatestBlockhash()
        .send()

      const useServerFeePayer = serverPaysFees && feePayerKey && !broadcast

      const txMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (msg) =>
          useServerFeePayer
            ? setTransactionMessageFeePayer(address(feePayerKey), msg)
            : setTransactionMessageFeePayerSigner(signer, msg),
        (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
        (msg) => setTransactionMessageComputeUnitLimit(50_000, msg),
        (msg) => setTransactionMessageComputeUnitPrice(1n, msg),
        (msg) => appendTransactionMessageInstructions(instructions, msg),
      )

      // When server pays fees, partially sign (only the transfer authority).
      // The server will add its fee payer signature before broadcasting.
      const signedTx = useServerFeePayer
        ? await partiallySignTransactionMessageWithSigners(txMessage)
        : await signTransactionMessageWithSigners(txMessage)

      const encodedTx = getBase64EncodedWireTransaction(signedTx)

      if (broadcast) {
        // ── Client-broadcast mode (type="signature") ──
        onProgress?.({ type: 'paying' })

        const signature = await rpc
          .sendTransaction(encodedTx, {
            encoding: 'base64',
            skipPreflight: false,
          })
          .send()

        onProgress?.({ type: 'confirming', signature })
        await confirmTransaction(rpc, signature)
        onProgress?.({ type: 'paid', signature })

        return Credential.serialize({
          challenge,
          payload: { type: 'signature', signature },
        })
      }

      // ── Server-broadcast mode (type="transaction", default) ──
      onProgress?.({ type: 'signed', transaction: encodedTx })

      return Credential.serialize({
        challenge,
        payload: { type: 'transaction', transaction: encodedTx },
      })
    },
  })

  return method
}

// ── Helpers ──

/**
 * Creates an Associated Token Account using the idempotent instruction
 * (CreateIdempotent = discriminator 1). This is a no-op if the ATA exists.
 */
function createAssociatedTokenAccountIdempotent(
  payer: TransactionSigner,
  owner: ReturnType<typeof address>,
  mint: ReturnType<typeof address>,
  ata: ReturnType<typeof address>,
  tokenProgram: ReturnType<typeof address>,
): Instruction {
  return {
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    accounts: [
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer } as any,
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: address('11111111111111111111111111111111'), role: AccountRole.READONLY },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]), // CreateIdempotent discriminator
  }
}

/**
 * Polls for transaction confirmation via getSignatureStatuses.
 * Only used in client-broadcast mode.
 */
async function confirmTransaction(
  rpc: ReturnType<typeof createSolanaRpc>,
  signature: string,
  timeoutMs = 30_000,
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { value } = await rpc
      .getSignatureStatuses([signature] as any)
      .send()
    const status = value[0]
    if (status) {
      if (status.err) {
        throw new Error(
          `Transaction failed: ${JSON.stringify(status.err)}`,
        )
      }
      if (
        status.confirmationStatus === 'confirmed' ||
        status.confirmationStatus === 'finalized'
      ) {
        return
      }
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  throw new Error('Transaction confirmation timeout')
}

export declare namespace charge {
  type Parameters = {
    /**
     * Solana transaction signer. Compatible with:
     * - ConnectorKit's `useTransactionSigner()` hook
     * - `createKeyPairSignerFromBytes()` from `@solana/kit` for headless usage
     * - Any `TransactionSigner` implementation
     */
    signer: TransactionSigner
    /** Custom RPC URL. If not set, inferred from the challenge's network field. */
    rpcUrl?: string
    /**
     * If true, the client broadcasts the transaction and sends the signature
     * as a `type="signature"` credential. If false (default), the client sends
     * the signed transaction bytes as a `type="transaction"` credential and the
     * server broadcasts it.
     *
     * Cannot be used with server fee sponsorship (feePayer mode).
     */
    broadcast?: boolean
    /** Called at each step of the payment process. */
    onProgress?: (event: ProgressEvent) => void
  }

  type ProgressEvent =
    | { type: 'challenge'; recipient: string; amount: string; currency: string; splToken?: string; feePayerKey?: string }
    | { type: 'signing' }
    | { type: 'signed'; transaction: string }
    | { type: 'paying' }
    | { type: 'confirming'; signature: string }
    | { type: 'paid'; signature: string }
}
