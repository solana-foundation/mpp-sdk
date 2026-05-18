import {
    createSignableMessage,
    getBase58Decoder,
    getBase58Encoder,
    getI64Encoder,
    getU64Encoder,
    type MessagePartialSigner,
} from '@solana/kit';
import type { Challenge as MppxChallenge } from 'mppx';
import { Credential, Method, z } from 'mppx';

import * as Methods from '../Methods.js';

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

/**
 * Default voucher expiry timestamp, matching the Rust SDK and program tests.
 */
export const DEFAULT_SESSION_EXPIRES_AT = 4_102_444_800;

/**
 * Numeric input accepted by the session helpers.
 */
export type AmountLike = bigint | number | string;

/**
 * Funding mode used to open a Solana payment session.
 */
export type SessionMode = 'pull' | 'push';

/**
 * Voucher authority used when a challenge advertises pull-mode sessions.
 *
 * `clientVoucher` does not require multi-delegate setup; `operatedVoucher`
 * is the operator-signed path that uses delegated token movement.
 */
export type SessionPullVoucherStrategy = 'clientVoucher' | 'operatedVoucher';

/**
 * Signer capable of Ed25519-signing exact voucher message bytes.
 */
export type SessionSigner = MessagePartialSigner;

/**
 * Basis-point split distributed when a session settles.
 */
export interface SessionSplit {
    readonly bps: number;
    readonly recipient: string;
}

/**
 * Request embedded in a Solana `session` challenge.
 */
export interface SessionRequest extends Record<string, unknown> {
    readonly cap: string;
    readonly currency: string;
    readonly decimals?: number | undefined;
    readonly description?: string | undefined;
    readonly externalId?: string | undefined;
    readonly minVoucherDelta?: string | undefined;
    readonly modes?: SessionMode[] | undefined;
    readonly network?: string | undefined;
    readonly operator: string;
    readonly programId?: string | undefined;
    readonly pullVoucherStrategy?: SessionPullVoucherStrategy | undefined;
    readonly recentBlockhash?: string | undefined;
    readonly recipient: string;
    readonly splits?: SessionSplit[] | undefined;
}

/**
 * Parsed MPP challenge for the Solana session method.
 */
export type SessionChallenge = MppxChallenge.Challenge<SessionRequest, 'session', 'solana'>;

/**
 * Voucher content signed by the client session key.
 */
export interface VoucherData {
    readonly channelId: string;
    readonly cumulativeAmount: string;
    readonly expiresAt: number;
    readonly nonce?: number | undefined;
}

/**
 * Voucher-like input accepted by low-level serialization helpers.
 */
export interface VoucherDataInput {
    readonly channelId: string;
    readonly cumulative?: AmountLike | undefined;
    readonly cumulativeAmount?: AmountLike | undefined;
    readonly expiresAt: AmountLike;
    readonly nonce?: number | undefined;
}

/**
 * Signed cumulative voucher.
 */
export interface SignedVoucher {
    readonly data: VoucherData;
    readonly signature: string;
}

/**
 * Open action payload for payment channels or delegated-token pull sessions.
 */
export interface OpenPayload {
    readonly approvedAmount?: string | undefined;
    readonly authorizedSigner: string;
    readonly channelId?: string | undefined;
    readonly deposit?: string | undefined;
    readonly gracePeriod?: number | undefined;
    readonly initMultiDelegateTx?: string | undefined;
    readonly mint?: string | undefined;
    readonly mode: SessionMode;
    readonly owner?: string | undefined;
    readonly payee?: string | undefined;
    readonly payer?: string | undefined;
    readonly salt?: string | undefined;
    readonly signature: string;
    readonly tokenAccount?: string | undefined;
    readonly transaction?: string | undefined;
    readonly updateDelegationTx?: string | undefined;
}

/**
 * Client action sent as a Solana session credential payload.
 */
export type SessionAction =
    | { readonly action: 'close'; readonly channelId: string; readonly voucher?: SignedVoucher | undefined }
    | { readonly action: 'commit'; readonly deliveryId: string; readonly voucher: SignedVoucher }
    | { readonly action: 'topUp'; readonly channelId: string; readonly newDeposit: string; readonly signature: string }
    | { readonly action: 'voucher'; readonly voucher: SignedVoucher }
    | (OpenPayload & { readonly action: 'open' });

/**
 * Payload body posted to a commit endpoint by the consumer helpers.
 */
export interface CommitPayload {
    readonly deliveryId: string;
    readonly voucher: SignedVoucher;
}

/**
 * Server-issued metering directive attached to a delivered message.
 */
export interface MeteringDirective {
    readonly amount: string;
    readonly commitUrl?: string | undefined;
    readonly currency: string;
    readonly deliveryId: string;
    readonly expiresAt: number;
    readonly proof?: string | undefined;
    readonly sequence: number;
    readonly sessionId: string;
}

/**
 * Final usage for a metered stream.
 */
export interface MeteringUsage {
    readonly amount: string;
    readonly deliveryId: string;
}

/**
 * Payload paired with the directive needed to acknowledge it.
 */
export interface MeteredEnvelope<Payload> {
    readonly metering: MeteringDirective;
    readonly payload: Payload;
}

/**
 * Commit status returned by the server.
 */
export type CommitStatus = 'committed' | 'replayed';

/**
 * Receipt returned after a commit is accepted.
 */
export interface CommitReceipt {
    readonly amount: string;
    readonly cumulative: string;
    readonly deliveryId: string;
    readonly sessionId: string;
    readonly status: CommitStatus;
}

/**
 * Context accepted by the `session()` MPP client method.
 */
export interface SessionContext {
    readonly action?: 'close' | 'commit' | 'open' | 'topUp' | 'voucher' | undefined;
    readonly amount?: AmountLike | undefined;
    readonly approvedAmount?: AmountLike | undefined;
    readonly cumulativeAmount?: AmountLike | undefined;
    readonly deliveryId?: string | undefined;
    readonly deposit?: AmountLike | undefined;
    readonly directive?: MeteringDirective | undefined;
    readonly finalIncrement?: AmountLike | undefined;
    readonly gracePeriod?: number | undefined;
    readonly initMultiDelegateTx?: string | undefined;
    readonly mint?: string | undefined;
    readonly mode?: SessionMode | undefined;
    readonly newDeposit?: AmountLike | undefined;
    readonly owner?: string | undefined;
    readonly payee?: string | undefined;
    readonly payer?: string | undefined;
    readonly salt?: AmountLike | undefined;
    readonly session?: ActiveSession | undefined;
    readonly signature?: string | undefined;
    readonly source?: string | undefined;
    readonly tokenAccount?: string | undefined;
    readonly transaction?: string | undefined;
    readonly updateDelegationTx?: string | undefined;
    readonly voucher?: SignedVoucher | undefined;
}

/**
 * Runtime context schema for mppx routing. Detailed validation happens in the SDK helper.
 */
export const sessionContextSchema = z.custom<SessionContext>();

/**
 * Builds canonical payment-channel voucher bytes:
 * `channel_id || cumulative_amount_le_u64 || expires_at_le_i64`.
 */
export function voucherMessageBytes(data: VoucherDataInput): Uint8Array {
    const channelIdBytes = getBase58Encoder().encode(data.channelId);
    if (channelIdBytes.byteLength !== 32) {
        throw new Error(`channelId must decode to 32 bytes; got ${channelIdBytes.byteLength}`);
    }

    const cumulative = parseAmount(requiredCumulative(data), 'cumulativeAmount');
    const expiresAt = parseI64(data.expiresAt, 'expiresAt');

    const bytes = new Uint8Array(48);
    bytes.set(channelIdBytes, 0);
    bytes.set(getU64Encoder().encode(cumulative), 32);
    bytes.set(getI64Encoder().encode(expiresAt), 40);
    return bytes;
}

/**
 * Serializes a Solana session action as an MPP `Authorization` header value.
 */
export function serializeSessionCredential(parameters: serializeSessionCredential.Parameters): string {
    return Credential.serialize({
        challenge: parameters.challenge,
        payload: parameters.payload,
        ...(parameters.source ? { source: parameters.source } : {}),
    });
}

export declare namespace serializeSessionCredential {
    interface Parameters {
        readonly challenge: SessionChallenge;
        readonly payload: SessionAction;
        readonly source?: string | undefined;
    }
}

/**
 * Tracks local voucher state for an open Solana payment session.
 */
export class ActiveSession {
    readonly #channelId: string;
    #cumulative: bigint;
    #expiresAt: number;
    #nonce: number;
    readonly #signer: SessionSigner;

    constructor(channelId: string, signer: SessionSigner, options?: ActiveSession.Options);
    constructor(parameters: ActiveSession.Parameters);
    constructor(
        channelIdOrParameters: ActiveSession.Parameters | string,
        signer?: SessionSigner,
        options: ActiveSession.Options = {},
    ) {
        const parameters =
            typeof channelIdOrParameters === 'string'
                ? {
                      channelId: channelIdOrParameters,
                      signer: requireValue(signer, 'signer'),
                      ...options,
                  }
                : channelIdOrParameters;

        this.#channelId = parameters.channelId;
        this.#signer = parameters.signer;
        this.#cumulative = parseAmount(parameters.cumulative ?? 0n, 'cumulative');
        this.#expiresAt = parseSafeInteger(parameters.expiresAt ?? DEFAULT_SESSION_EXPIRES_AT, 'expiresAt');
        this.#nonce = Number(parseAmount(parameters.nonce ?? 0n, 'nonce'));
    }

    /** Channel/session identifier used by all vouchers. */
    get channelId(): string {
        return this.#channelId;
    }

    /** Current local cumulative watermark. */
    get cumulative(): bigint {
        return this.#cumulative;
    }

    /** Current local cumulative watermark as a decimal string. */
    get cumulativeAmount(): string {
        return this.#cumulative.toString();
    }

    /** Expiry timestamp used for newly signed vouchers. */
    get expiresAt(): number {
        return this.#expiresAt;
    }

    /** Current local voucher nonce. */
    get nonce(): number {
        return this.#nonce;
    }

    /** Session key authorized to sign vouchers. */
    get signer(): SessionSigner {
        return this.#signer;
    }

    /** Public key authorized to sign vouchers. */
    get authorizedSigner(): string {
        return this.#signer.address;
    }

    /** Updates the expiry timestamp used for subsequent vouchers. */
    setExpiresAt(expiresAt: AmountLike): void {
        this.#expiresAt = parseSafeInteger(expiresAt, 'expiresAt');
    }

    /**
     * Signs an absolute cumulative voucher without advancing local state.
     */
    async prepareVoucher(cumulative: AmountLike): Promise<SignedVoucher> {
        const nextCumulative = parseAmount(cumulative, 'cumulative');
        if (nextCumulative <= this.#cumulative) {
            throw new Error(
                `Voucher cumulative ${nextCumulative.toString()} must exceed current watermark ${this.#cumulative.toString()}`,
            );
        }

        const data: VoucherData = {
            channelId: this.#channelId,
            cumulativeAmount: nextCumulative.toString(),
            expiresAt: this.#expiresAt,
            nonce: this.#nonce + 1,
        };

        const [signatureDictionary] = await this.#signer.signMessages([
            createSignableMessage(voucherMessageBytes(data)),
        ]);
        const signatureBytes = signatureDictionary?.[this.#signer.address];
        if (!signatureBytes) {
            throw new Error(`Signer ${this.#signer.address} did not return a voucher signature`);
        }

        return {
            data,
            signature: getBase58Decoder().decode(new Uint8Array(signatureBytes)),
        };
    }

    /**
     * Signs an increment from the current watermark without advancing local state.
     */
    async prepareIncrement(amount: AmountLike): Promise<SignedVoucher> {
        return await this.prepareVoucher(this.#cumulative + parseAmount(amount, 'amount'));
    }

    /**
     * Records a prepared voucher as accepted by the server.
     */
    recordVoucher(voucher: SignedVoucher): void {
        if (voucher.data.channelId !== this.#channelId) {
            throw new Error(
                `Voucher channel ${voucher.data.channelId} does not match active session ${this.#channelId}`,
            );
        }

        const cumulative = parseAmount(voucher.data.cumulativeAmount, 'cumulativeAmount');
        if (cumulative <= this.#cumulative) {
            throw new Error(
                `Voucher cumulative ${cumulative.toString()} must exceed current watermark ${this.#cumulative.toString()}`,
            );
        }

        this.#cumulative = cumulative;
        this.#nonce =
            voucher.data.nonce === undefined
                ? this.#nonce + 1
                : Math.max(this.#nonce, parseSafeInteger(voucher.data.nonce, 'nonce'));
    }

    /**
     * Signs an absolute cumulative voucher and advances local state.
     */
    async signVoucher(cumulative: AmountLike): Promise<SignedVoucher> {
        const voucher = await this.prepareVoucher(cumulative);
        this.recordVoucher(voucher);
        return voucher;
    }

    /**
     * Signs an increment from the current watermark and advances local state.
     */
    async signIncrement(amount: AmountLike): Promise<SignedVoucher> {
        return await this.signVoucher(this.#cumulative + parseAmount(amount, 'amount'));
    }

    /**
     * Builds a `voucher` action for a freshly signed increment.
     */
    async voucherAction(amount: AmountLike): Promise<SessionAction> {
        return { action: 'voucher', voucher: await this.signIncrement(amount) };
    }

    /**
     * Builds a `commit` action for a delivery and freshly signed increment.
     */
    async commitAction(delivery: MeteringDirective | string, amount?: AmountLike): Promise<SessionAction> {
        const deliveryId = typeof delivery === 'string' ? delivery : delivery.deliveryId;
        const resolvedAmount =
            typeof delivery === 'string' ? requireValue(amount, 'amount') : (amount ?? delivery.amount);
        return { action: 'commit', deliveryId, voucher: await this.signIncrement(resolvedAmount) };
    }

    /**
     * Builds a payment-channel `open` action.
     */
    openAction(
        deposit: AmountLike,
        signature: string,
        options: ActiveSession.OpenOptions = {},
    ): OpenPayload & { readonly action: 'open' } {
        return {
            action: 'open',
            authorizedSigner: this.authorizedSigner,
            channelId: this.#channelId,
            deposit: formatAmount(deposit, 'deposit'),
            mode: options.mode ?? 'push',
            signature,
            ...(options.transaction ? { transaction: options.transaction } : {}),
        };
    }

    /**
     * Builds a detailed payment-channel `open` action.
     */
    openPaymentChannelAction(
        parameters: ActiveSession.PaymentChannelOpenParameters,
    ): OpenPayload & { readonly action: 'open' } {
        return {
            action: 'open',
            authorizedSigner: this.authorizedSigner,
            channelId: this.#channelId,
            deposit: formatAmount(parameters.deposit, 'deposit'),
            gracePeriod: parameters.gracePeriod,
            mint: parameters.mint,
            mode: parameters.mode ?? 'push',
            payee: parameters.payee,
            payer: parameters.payer,
            salt: formatAmount(parameters.salt, 'salt'),
            signature: parameters.signature,
            ...(parameters.transaction ? { transaction: parameters.transaction } : {}),
        };
    }

    /**
     * Builds a pull-mode `open` action after delegation is confirmed.
     */
    openPullAction(parameters: ActiveSession.PullOpenParameters): OpenPayload & { readonly action: 'open' } {
        return {
            action: 'open',
            approvedAmount: formatAmount(parameters.approvedAmount, 'approvedAmount'),
            authorizedSigner: this.authorizedSigner,
            ...(parameters.initMultiDelegateTx ? { initMultiDelegateTx: parameters.initMultiDelegateTx } : {}),
            mode: 'pull',
            owner: parameters.owner,
            signature: parameters.signature,
            tokenAccount: parameters.tokenAccount ?? this.#channelId,
            ...(parameters.updateDelegationTx ? { updateDelegationTx: parameters.updateDelegationTx } : {}),
        };
    }

    /**
     * Builds a `topUp` action after the top-up transaction is confirmed.
     */
    topUpAction(newDeposit: AmountLike, signature: string): SessionAction {
        return {
            action: 'topUp',
            channelId: this.#channelId,
            newDeposit: formatAmount(newDeposit, 'newDeposit'),
            signature,
        };
    }

    /**
     * Builds a cooperative `close` action, optionally signing a final increment.
     */
    async closeAction(finalIncrement?: AmountLike): Promise<SessionAction> {
        if (finalIncrement === undefined || parseAmount(finalIncrement, 'finalIncrement') === 0n) {
            return { action: 'close', channelId: this.#channelId };
        }

        return {
            action: 'close',
            channelId: this.#channelId,
            voucher: await this.signIncrement(finalIncrement),
        };
    }
}

export declare namespace ActiveSession {
    interface Options {
        readonly cumulative?: AmountLike | undefined;
        readonly expiresAt?: AmountLike | undefined;
        readonly nonce?: AmountLike | undefined;
    }

    interface Parameters extends Options {
        readonly channelId: string;
        readonly signer: SessionSigner;
    }

    interface OpenOptions {
        readonly mode?: SessionMode | undefined;
        readonly transaction?: string | undefined;
    }

    interface PaymentChannelOpenParameters extends OpenOptions {
        readonly deposit: AmountLike;
        readonly gracePeriod: number;
        readonly mint: string;
        readonly payee: string;
        readonly payer: string;
        readonly salt: AmountLike;
        readonly signature: string;
    }

    interface PullOpenParameters {
        readonly approvedAmount: AmountLike;
        readonly initMultiDelegateTx?: string | undefined;
        readonly owner: string;
        readonly signature: string;
        readonly tokenAccount?: string | undefined;
        readonly updateDelegationTx?: string | undefined;
    }
}

/**
 * Creates the Solana `session` MPP client method.
 */
export function session(parameters: session.Parameters = {}) {
    let activeSession =
        parameters.session ??
        (parameters.channelId && parameters.signer
            ? new ActiveSession({
                  channelId: parameters.channelId,
                  expiresAt: parameters.expiresAt,
                  signer: parameters.signer,
              })
            : undefined);

    const getSession = (context: SessionContext | undefined): ActiveSession => {
        activeSession = context?.session ?? activeSession;
        if (!activeSession) {
            throw new Error('session action requires an ActiveSession or both `channelId` and `signer` parameters');
        }
        return activeSession;
    };

    const createAction = async (
        challenge: SessionChallenge,
        context: SessionContext | undefined,
    ): Promise<SessionAction> => {
        if (!context?.action && parameters.createAction) {
            return await parameters.createAction({ challenge, context, session: activeSession });
        }

        switch (context?.action) {
            case 'open':
                return createOpenAction(getSession(context), challenge, context);
            case 'voucher':
                return await createVoucherAction(getSession(context), context);
            case 'commit':
                return await createCommitAction(getSession(context), context);
            case 'topUp':
                return getSession(context).topUpAction(
                    requireValue(context.newDeposit ?? context.deposit, 'newDeposit'),
                    requireString(context.signature, 'signature'),
                );
            case 'close':
                return await getSession(context).closeAction(context.finalIncrement ?? context.amount);
            case undefined:
                throw new Error(
                    'No session action provided. Pass context.action or configure session({ createAction }).',
                );
        }
    };

    return Method.toClient(Methods.session, {
        context: sessionContextSchema,
        async createCredential({ challenge, context }) {
            const payload = await createAction(challenge, context);
            return serializeSessionCredential({
                challenge,
                payload,
                source: context?.source ?? parameters.source,
            });
        },
    });
}

export declare namespace session {
    interface CreateActionParameters {
        readonly challenge: SessionChallenge;
        readonly context?: SessionContext | undefined;
        readonly session?: ActiveSession | undefined;
    }

    interface Parameters {
        readonly channelId?: string | undefined;
        readonly createAction?:
            | ((parameters: CreateActionParameters) => Promise<SessionAction> | SessionAction)
            | undefined;
        readonly expiresAt?: AmountLike | undefined;
        readonly session?: ActiveSession | undefined;
        readonly signer?: SessionSigner | undefined;
        readonly source?: string | undefined;
    }
}

function createOpenAction(
    session_: ActiveSession,
    challenge: SessionChallenge,
    context: SessionContext,
): SessionAction {
    const signature = requireString(context.signature, 'signature');
    const mode = context.mode ?? challenge.request.modes?.[0] ?? 'push';

    if (mode === 'pull' && shouldUseDelegatedPull(context, challenge)) {
        return session_.openPullAction({
            approvedAmount: context.approvedAmount ?? context.deposit ?? challenge.request.cap,
            initMultiDelegateTx: context.initMultiDelegateTx,
            owner: requireString(context.owner, 'owner'),
            signature,
            tokenAccount: context.tokenAccount,
            updateDelegationTx: context.updateDelegationTx,
        });
    }

    if (
        context.payer !== undefined ||
        context.payee !== undefined ||
        context.mint !== undefined ||
        context.salt !== undefined ||
        context.gracePeriod !== undefined
    ) {
        return session_.openPaymentChannelAction({
            deposit: context.deposit ?? challenge.request.cap,
            gracePeriod: requireValue(context.gracePeriod, 'gracePeriod'),
            mint: requireString(context.mint, 'mint'),
            mode,
            payee: requireString(context.payee, 'payee'),
            payer: requireString(context.payer, 'payer'),
            salt: requireValue(context.salt, 'salt'),
            signature,
            transaction: context.transaction,
        });
    }

    return session_.openAction(context.deposit ?? challenge.request.cap, signature, {
        mode,
        transaction: context.transaction,
    });
}

function shouldUseDelegatedPull(context: SessionContext, challenge: SessionChallenge): boolean {
    if (context.mode !== 'pull' && challenge.request.modes?.[0] !== 'pull') return false;
    return (
        challenge.request.pullVoucherStrategy === 'operatedVoucher' ||
        context.approvedAmount !== undefined ||
        context.initMultiDelegateTx !== undefined ||
        context.owner !== undefined ||
        context.tokenAccount !== undefined ||
        context.updateDelegationTx !== undefined
    );
}

async function createVoucherAction(session_: ActiveSession, context: SessionContext): Promise<SessionAction> {
    if (context.voucher) return { action: 'voucher', voucher: context.voucher };
    if (context.cumulativeAmount !== undefined) {
        return { action: 'voucher', voucher: await session_.signVoucher(context.cumulativeAmount) };
    }
    return await session_.voucherAction(requireValue(context.amount, 'amount'));
}

async function createCommitAction(session_: ActiveSession, context: SessionContext): Promise<SessionAction> {
    const deliveryId = context.deliveryId ?? context.directive?.deliveryId;
    if (!deliveryId) throw new Error('deliveryId required for commit action');
    return await session_.commitAction(deliveryId, context.amount ?? context.directive?.amount);
}

function requiredCumulative(data: VoucherDataInput): AmountLike {
    if (data.cumulativeAmount !== undefined) return data.cumulativeAmount;
    if (data.cumulative !== undefined) return data.cumulative;
    throw new Error('cumulativeAmount required');
}

function formatAmount(value: AmountLike, name: string): string {
    return parseAmount(value, name).toString();
}

function parseAmount(value: AmountLike, name: string): bigint {
    const parsed = parseInteger(value, name);
    if (parsed < 0n) throw new Error(`${name} must be non-negative`);
    if (parsed > U64_MAX) throw new Error(`${name} exceeds u64 max`);
    return parsed;
}

function parseI64(value: AmountLike, name: string): bigint {
    const parsed = parseInteger(value, name);
    if (parsed < I64_MIN || parsed > I64_MAX) throw new Error(`${name} is outside i64 range`);
    return parsed;
}

function parseSafeInteger(value: AmountLike, name: string): number {
    const parsed = parseInteger(value, name);
    if (parsed < 0n) throw new Error(`${name} must be non-negative`);
    if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name} exceeds Number.MAX_SAFE_INTEGER`);
    return Number(parsed);
}

function parseInteger(value: AmountLike, name: string): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
        return BigInt(value);
    }
    if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer string`);
    return BigInt(value);
}

function requireString(value: string | undefined, name: string): string {
    if (!value) throw new Error(`${name} required`);
    return value;
}

function requireValue<Value>(value: Value | undefined, name: string): Value {
    if (value === undefined) throw new Error(`${name} required`);
    return value;
}
