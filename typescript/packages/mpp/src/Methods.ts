import { Method, z } from 'mppx';

const sessionMode = z.enum(['push', 'pull']);
const sessionPullVoucherStrategy = z.enum(['clientVoucher', 'operatedVoucher']);

const signedVoucher = z.object({
    data: z.object({
        /** Channel/session ID the voucher is bound to. */
        channelId: z.string(),
        /** Cumulative amount authorized in base units. */
        cumulativeAmount: z.string(),
        /** Unix timestamp at which this voucher expires. */
        expiresAt: z.number(),
        /** Optional client-side voucher counter. Not included in signed bytes. */
        nonce: z.optional(z.number()),
    }),
    /** Base58 Ed25519 signature over the canonical voucher bytes. */
    signature: z.string(),
});

/**
 * Solana charge method — shared schema used by both server and client.
 *
 * Supports two settlement modes:
 *
 * - **Pull mode** (`type="transaction"`, default): Client signs the
 *   transaction and sends the bytes to the server. The server broadcasts,
 *   confirms, and verifies the transfer on-chain.
 *
 * - **Push mode** (`type="signature"`): Client broadcasts the transaction
 *   itself and sends the confirmed signature. The server verifies on-chain.
 */
export const charge = Method.from({
    intent: 'charge',
    name: 'solana',
    schema: {
        credential: {
            payload: z.object({
                /** Base58-encoded transaction signature (when type="signature"). */
                signature: z.optional(z.string()),
                /** Base64-encoded serialized signed transaction (when type="transaction"). */
                transaction: z.optional(z.string()),
                /** Payload type: "transaction" (server broadcasts) or "signature" (client already broadcast). */
                type: z.string(),
            }),
        },
        request: z.object({
            /** Amount in smallest unit (lamports for SOL, base units for SPL tokens). */
            amount: z.string(),
            /** Identifies the unit for amount. "sol" (lowercase) for native SOL, or the token mint address for SPL tokens. */
            currency: z.string(),
            /** Human-readable memo describing the resource or service being paid for. */
            description: z.optional(z.string()),
            /** Merchant's reference (e.g., order ID, invoice number) for reconciliation. */
            externalId: z.optional(z.string()),
            methodDetails: z.object({
                /** Token decimals (required for SPL token transfers). */
                decimals: z.optional(z.number()),
                /** If true, server pays transaction fees. Client must use the server's feePayerKey. */
                feePayer: z.optional(z.boolean()),
                /** Server's base58-encoded public key for fee payment. Present when feePayer is true. */
                feePayerKey: z.optional(z.string()),
                /** Solana network: mainnet-beta, devnet, or localnet. */
                network: z.optional(z.string()),
                /** Server-provided base58-encoded recent blockhash. Saves the client an RPC round-trip. */
                recentBlockhash: z.optional(z.string()),
                /** Additional payment splits (max 8). Same asset as primary payment. */
                splits: z.optional(
                    z.array(
                        z.object({
                            /** Amount in base units (same asset as primary). */
                            amount: z.string(),
                            /** If true, the split recipient ATA must be created idempotently before payment. */
                            ataCreationRequired: z.optional(z.boolean()),
                            /** Optional memo for this split (max 566 bytes). */
                            memo: z.optional(z.string()),
                            /** Base58-encoded recipient of this split. */
                            recipient: z.string(),
                        }),
                    ),
                ),
                /** Token program address (TOKEN_PROGRAM or TOKEN_2022_PROGRAM). Defaults from the currency mint. */
                tokenProgram: z.optional(z.string()),
            }),
            /** Base58-encoded recipient public key. */
            recipient: z.string(),
        }),
    },
});

/**
 * Solana session method — shared schema used by both server and client.
 *
 * A session opens a payment channel or delegation once, then pays for later
 * deliveries with cumulative off-chain vouchers.
 */
export const session = Method.from({
    intent: 'session',
    name: 'solana',
    schema: {
        credential: {
            payload: z.discriminatedUnion('action', [
                z.object({
                    /** Session lifecycle action. */
                    action: z.literal('open'),

                    /** SPL approved amount for pull mode. */
                    approvedAmount: z.optional(z.string()),

                    /** Public key authorized to sign vouchers for this session. */
                    authorizedSigner: z.string(),
                    /** Payment-channel address for push mode. */
                    channelId: z.optional(z.string()),
                    /** Deposit locked by the channel open, in base units. */
                    deposit: z.optional(z.string()),
                    /** Grace period used by the payment-channels close path. */
                    gracePeriod: z.optional(z.number()),
                    /** Pre-signed pull-mode initialization transaction. */
                    initMultiDelegateTx: z.optional(z.string()),
                    /** SPL mint locked in the channel. */
                    mint: z.optional(z.string()),
                    /** Session funding mode. */
                    mode: sessionMode,
                    /** Client wallet owner for pull mode. */
                    owner: z.optional(z.string()),

                    /** Primary channel payee. */
                    payee: z.optional(z.string()),

                    /** Client wallet funding the push-mode channel. */
                    payer: z.optional(z.string()),
                    /** PDA salt used for the payment-channel address. */
                    salt: z.optional(z.union([z.string(), z.number()])),
                    /** On-chain transaction signature proving the open. */
                    signature: z.string(),
                    /** SPL token account used as the pull-mode session identifier. */
                    tokenAccount: z.optional(z.string()),
                    /** Signed transaction for operator/server broadcast. */
                    transaction: z.optional(z.string()),
                    /** Pre-signed pull-mode delegation cap update transaction. */
                    updateDelegationTx: z.optional(z.string()),
                }),
                z.object({
                    action: z.literal('voucher'),
                    voucher: signedVoucher,
                }),
                z.object({
                    action: z.literal('commit'),
                    deliveryId: z.string(),
                    voucher: signedVoucher,
                }),
                z.object({
                    action: z.literal('topUp'),
                    channelId: z.string(),
                    newDeposit: z.string(),
                    signature: z.string(),
                }),
                z.object({
                    action: z.literal('close'),
                    channelId: z.string(),
                    voucher: z.optional(signedVoucher),
                }),
            ]),
        },
        request: z.object({
            /** Maximum total amount the client may spend in this session, in base units. */
            cap: z.string(),
            /** Currency or SPL mint identifier. */
            currency: z.string(),
            /** Token decimals. Defaults to USDC-like 6 decimals server-side. */
            decimals: z.optional(z.number()),
            /** Human-readable memo for the session. */
            description: z.optional(z.string()),
            /** Merchant/session reference. */
            externalId: z.optional(z.string()),
            /** Minimum voucher increment, in base units. */
            minVoucherDelta: z.optional(z.string()),
            /** Supported funding modes. Omitted means push mode only. */
            modes: z.optional(z.array(sessionMode)),
            /** Solana network: mainnet-beta, devnet, or localnet. */
            network: z.optional(z.string()),
            /** Operator/server public key. */
            operator: z.string(),
            /** Payment-channels program ID. */
            programId: z.optional(z.string()),
            /** Voucher authority for pull-mode sessions. */
            pullVoucherStrategy: z.optional(sessionPullVoucherStrategy),
            /** Server-provided recent blockhash. */
            recentBlockhash: z.optional(z.string()),
            /** Primary recipient for channel proceeds. */
            recipient: z.string(),
            /** Optional basis-point splits distributed at close. */
            splits: z.optional(
                z.array(
                    z.object({
                        /** Share in basis points. */
                        bps: z.number(),
                        /** Split recipient public key. */
                        recipient: z.string(),
                    }),
                ),
            ),
        }),
    },
});
