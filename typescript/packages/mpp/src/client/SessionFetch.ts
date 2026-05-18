import { generateKeyPairSigner, getBase58Decoder } from '@solana/kit';

import {
    selectSolanaSessionChallengeFromResponse,
    type SelectSolanaSessionChallengeOptions,
} from './ChallengeSelection.js';
import {
    ActiveSession,
    type AmountLike,
    type CommitReceipt,
    DEFAULT_SESSION_EXPIRES_AT,
    type MeteringDirective,
    type OpenPayload,
    serializeSessionCredential,
    type SessionChallenge,
    type SessionMode,
    type SignedVoucher,
} from './Session.js';

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

const DEFAULT_LIVE_COMMIT_INTERVAL_MS = 1_000;
const U64_MAX = (1n << 64n) - 1n;

/**
 * Request tuple returned by request preparation hooks.
 */
export interface PreparedFetchRequest {
    readonly init?: FetchInit;
    readonly input: FetchInput;
}

/**
 * Session details returned by an opener after local/on-chain setup succeeds.
 */
export interface SessionOpenResult {
    readonly payload: OpenPayload & { readonly action: 'open' };
    readonly session: ActiveSession;
    readonly source?: string | undefined;
}

/**
 * Parameters passed to a session opener.
 */
export interface SessionOpenParameters {
    readonly challenge: SessionChallenge;
    readonly init?: FetchInit;
    readonly input: FetchInput;
    readonly response: Response;
}

/**
 * Opens a payment session and returns the action that should authorize the retry.
 */
export type SessionOpener = (parameters: SessionOpenParameters) => Promise<SessionOpenResult> | SessionOpenResult;

/**
 * Hook for transforming requests before the first attempt and paid retry.
 */
export type PrepareSessionRequest = (request: PreparedFetchRequest) => PreparedFetchRequest;

/**
 * State created after a 402 session challenge has been paid.
 */
export interface SessionFetchOpenState extends SessionOpenResult {
    readonly authorization: string;
    readonly challenge: SessionChallenge;
    readonly commitUrl: string;
}

/**
 * Parameters used to reserve a metered delivery.
 */
export interface ReserveSessionDeliveryParameters {
    readonly amount: string;
    readonly commitUrl: string;
    readonly deliveryId: string;
    readonly session: ActiveSession;
}

/**
 * Parameters used to commit a metered delivery.
 */
export interface CommitSessionDeliveryParameters {
    readonly amount: string;
    readonly authorization: string;
    readonly directive: MeteringDirective;
    readonly session: ActiveSession;
    readonly voucher: SignedVoucher;
}

/**
 * Events emitted by `SessionFetchClient`.
 */
export type SessionFetchEvent =
    | {
          readonly cumulativeAmount: string;
          readonly deltaAmount: string;
          readonly sessionId: string;
          readonly type: 'watermark';
      }
    | { readonly challenge: SessionChallenge; readonly type: 'challenge' }
    | { readonly open: SessionFetchOpenState; readonly type: 'open' }
    | { readonly receipt: CommitReceipt; readonly type: 'commit' }
    | { readonly response: Response; readonly type: 'retry' };

/**
 * High-level HTTP helper for Solana payment sessions.
 *
 * It handles session 402 challenges, paid retries, delivery reservations, and
 * throttled cumulative voucher commits. Apps only need to open the session and
 * report their current metered cumulative amount while they stream work.
 */
export class SessionFetchClient {
    readonly #fetch: typeof globalThis.fetch;
    readonly #liveCommitIntervalMs: number;
    readonly #onEvent: ((event: SessionFetchEvent) => void) | undefined;
    readonly #opener: SessionOpener;
    readonly #prepareRequest: PrepareSessionRequest | undefined;
    readonly #selectChallengeOptions: SelectSolanaSessionChallengeOptions | undefined;

    #commitFailure: Error | undefined;
    #commitQueue: Promise<CommitReceipt | null> = Promise.resolve(null);
    #lastCommitQueuedAt = 0;
    #lastQueuedCumulative = 0n;
    #open: SessionFetchOpenState | undefined;
    #targetCumulative: bigint | undefined;
    #trailingCommitTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(parameters: SessionFetchClient.Parameters) {
        this.#fetch = parameters.fetch ?? globalThis.fetch;
        this.#liveCommitIntervalMs = parameters.liveCommitIntervalMs ?? DEFAULT_LIVE_COMMIT_INTERVAL_MS;
        this.#onEvent = parameters.onEvent;
        this.#opener = parameters.opener;
        this.#prepareRequest = parameters.prepareRequest;
        this.#selectChallengeOptions = parameters.selectChallenge;
    }

    /**
     * Drop-in replacement for `fetch`.
     */
    readonly fetch: typeof globalThis.fetch = async (input, init) => {
        return await this.fetchWithSession(input, init);
    };

    /** Last open session state, when available. */
    get open(): SessionFetchOpenState | undefined {
        return this.#open;
    }

    /** Active local session, when available. */
    get session(): ActiveSession | undefined {
        return this.#open?.session;
    }

    /** Current accepted cumulative voucher amount. */
    get cumulativeAmount(): string {
        return this.#open?.session.cumulativeAmount ?? '0';
    }

    /** Highest locally observed cumulative watermark. */
    get targetCumulativeAmount(): string | undefined {
        return this.#targetCumulative?.toString();
    }

    /**
     * Fetches a resource, automatically opening a session when a Solana session
     * 402 challenge is returned.
     */
    async fetchWithSession(input: FetchInput, init?: FetchInit): Promise<Response> {
        this.throwCommitFailure();
        const prepared = this.prepare({ init, input: cloneFetchInput(input) });
        const response = await this.#fetch(prepared.input, prepared.init);
        if (response.status !== 402) {
            return response;
        }

        const challenge = selectSolanaSessionChallengeFromResponse(response, this.#selectChallengeOptions);
        if (!challenge) {
            return response;
        }

        this.emit({ challenge, type: 'challenge' });
        const opened = await this.#opener({
            challenge,
            init,
            input,
            response,
        });
        const authorization = serializeSessionCredential({
            challenge,
            payload: opened.payload,
            source: opened.source,
        });
        const open: SessionFetchOpenState = {
            ...opened,
            authorization,
            challenge,
            commitUrl: requestUrl(input),
        };
        this.#open = open;
        this.emit({ open, type: 'open' });

        const retry = this.prepare({
            init: withAuthorization(init, authorization),
            input: cloneFetchInput(input),
        });
        const retryResponse = await this.#fetch(retry.input, retry.init);
        this.emit({ response: retryResponse, type: 'retry' });
        if (retryResponse.ok) {
            this.#lastQueuedCumulative = opened.session.cumulative;
        }
        return retryResponse;
    }

    /**
     * Records the latest absolute cumulative amount. The client emits the local
     * watermark immediately and sends a voucher commit at most once per interval.
     */
    recordCumulative(cumulativeAmount: AmountLike, options: SessionFetchClient.RecordOptions = {}): void {
        this.throwCommitFailure();
        const open = this.requireOpen();
        const target = parseAmount(cumulativeAmount, 'cumulativeAmount');
        const current = open.session.cumulative;
        if (target <= current) {
            return;
        }

        this.#targetCumulative =
            this.#targetCumulative === undefined || target > this.#targetCumulative ? target : this.#targetCumulative;

        this.emit({
            cumulativeAmount: target.toString(),
            deltaAmount: formatAmount(options.deltaAmount ?? target - current, 'deltaAmount'),
            sessionId: open.session.channelId,
            type: 'watermark',
        });

        const now = Date.now();
        if (options.force || now - this.#lastCommitQueuedAt >= this.#liveCommitIntervalMs) {
            this.clearTrailingCommit();
            this.#lastCommitQueuedAt = now;
            this.queueCommit(target);
        } else {
            this.scheduleTrailingCommit(this.#liveCommitIntervalMs - (now - this.#lastCommitQueuedAt));
        }
    }

    /**
     * Commits an absolute cumulative amount immediately.
     */
    async commitCumulative(cumulativeAmount: AmountLike): Promise<CommitReceipt | null> {
        this.recordCumulative(cumulativeAmount, { force: true });
        return await this.flush();
    }

    /**
     * Sends the latest recorded cumulative watermark and waits for all pending
     * commits to settle.
     */
    async flush(): Promise<CommitReceipt | null> {
        this.throwCommitFailure();
        if (this.#targetCumulative !== undefined) {
            this.clearTrailingCommit();
            this.queueCommit(this.#targetCumulative);
        }

        const receipt = await this.#commitQueue;
        this.throwCommitFailure();
        return receipt;
    }

    private prepare(request: PreparedFetchRequest): PreparedFetchRequest {
        return this.#prepareRequest ? this.#prepareRequest(request) : request;
    }

    private queueCommit(target: bigint): void {
        if (target <= this.#lastQueuedCumulative) {
            return;
        }
        this.#lastQueuedCumulative = target;
        this.#commitQueue = this.#commitQueue
            .then(async () => await this.commitTarget(target))
            .catch(error => {
                this.#commitFailure = toError(error);
                return null;
            });
    }

    private scheduleTrailingCommit(delayMs: number): void {
        if (this.#trailingCommitTimer !== undefined) {
            return;
        }

        this.#trailingCommitTimer = setTimeout(
            () => {
                this.#trailingCommitTimer = undefined;
                if (this.#targetCumulative === undefined) {
                    return;
                }
                this.#lastCommitQueuedAt = Date.now();
                this.queueCommit(this.#targetCumulative);
            },
            Math.max(0, delayMs),
        );
    }

    private clearTrailingCommit(): void {
        if (this.#trailingCommitTimer === undefined) {
            return;
        }
        clearTimeout(this.#trailingCommitTimer);
        this.#trailingCommitTimer = undefined;
    }

    private async commitTarget(target: bigint): Promise<CommitReceipt | null> {
        const open = this.requireOpen();
        const current = open.session.cumulative;
        if (target <= current) {
            return null;
        }

        const amount = (target - current).toString();
        const directive = await this.reserveDelivery({
            amount,
            commitUrl: open.commitUrl,
            deliveryId: defaultDeliveryId(),
            session: open.session,
        });
        const voucher = await open.session.prepareVoucher(target);
        const authorization = serializeSessionCredential({
            challenge: open.challenge,
            payload: {
                action: 'commit',
                deliveryId: directive.deliveryId,
                voucher,
            },
            source: open.source,
        });
        const receipt = await this.commitDelivery({
            amount,
            authorization,
            directive,
            session: open.session,
            voucher,
        });

        open.session.recordVoucher(voucher);
        this.emit({ receipt, type: 'commit' });
        return receipt;
    }

    private async reserveDelivery(parameters: ReserveSessionDeliveryParameters): Promise<MeteringDirective> {
        const url = new URL('/__402/session/deliveries', parameters.commitUrl);
        const response = await this.#fetch(url, {
            body: JSON.stringify({
                amount: parameters.amount,
                commitUrl: parameters.commitUrl,
                deliveryId: parameters.deliveryId,
                sessionId: parameters.session.channelId,
            }),
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
            },
            method: 'POST',
        });

        if (!response.ok) {
            throw new Error(`delivery reservation returned ${response.status}: ${await response.text()}`);
        }

        return (await response.json()) as MeteringDirective;
    }

    private async commitDelivery(parameters: CommitSessionDeliveryParameters): Promise<CommitReceipt> {
        const response = await this.#fetch(parameters.directive.commitUrl ?? this.requireOpen().commitUrl, {
            body: JSON.stringify({
                amount: parameters.amount,
                deliveryId: parameters.directive.deliveryId,
            }),
            headers: {
                accept: 'application/json',
                authorization: parameters.authorization,
                'content-type': 'application/json',
            },
            method: 'POST',
        });

        if (!response.ok) {
            throw new Error(`session commit returned ${response.status}: ${await response.text()}`);
        }

        return (await response.json()) as CommitReceipt;
    }

    private requireOpen(): SessionFetchOpenState {
        if (!this.#open) {
            throw new Error('session has not been opened yet');
        }
        return this.#open;
    }

    private throwCommitFailure(): void {
        if (this.#commitFailure) {
            throw this.#commitFailure;
        }
    }

    private emit(event: SessionFetchEvent): void {
        this.#onEvent?.(event);
    }
}

export declare namespace SessionFetchClient {
    interface Parameters {
        readonly fetch?: typeof globalThis.fetch | undefined;
        readonly liveCommitIntervalMs?: number | undefined;
        readonly onEvent?: ((event: SessionFetchEvent) => void) | undefined;
        readonly opener: SessionOpener;
        readonly prepareRequest?: PrepareSessionRequest | undefined;
        readonly selectChallenge?: SelectSolanaSessionChallengeOptions | undefined;
    }

    interface RecordOptions {
        readonly deltaAmount?: AmountLike | undefined;
        readonly force?: boolean | undefined;
    }
}

/**
 * Creates a high-level Solana session fetch client.
 */
export function createSessionFetch(parameters: SessionFetchClient.Parameters): SessionFetchClient {
    return new SessionFetchClient(parameters);
}

/**
 * Creates a development-only opener that fabricates pull/push open proofs.
 *
 * This is useful for local gateways and demos. Production clients should pass an
 * opener that performs the real wallet approval or channel open transaction.
 */
export function createEphemeralSessionOpener(options: createEphemeralSessionOpener.Options = {}): SessionOpener {
    return async ({ challenge }) => {
        const signer = await generateKeyPairSigner();
        const channel = await generateKeyPairSigner();
        const requestedMode = options.mode ?? challenge.request.modes?.[0] ?? 'push';
        const mode = requestedMode === 'pull' && challenge.request.modes?.includes('pull') ? 'pull' : requestedMode;
        const session = new ActiveSession({
            channelId: channel.address,
            cumulative: options.cumulative ?? 0n,
            expiresAt: options.expiresAt ?? DEFAULT_SESSION_EXPIRES_AT,
            signer,
        });
        const signature = options.signature ?? randomBase58(64);
        const useDelegatedPull =
            mode === 'pull' &&
            (challenge.request.pullVoucherStrategy === 'operatedVoucher' ||
                options.approvedAmount !== undefined ||
                options.initMultiDelegateTx !== undefined ||
                options.owner !== undefined ||
                options.tokenAccount !== undefined ||
                options.updateDelegationTx !== undefined);
        const payload = useDelegatedPull
            ? session.openPullAction({
                  approvedAmount: options.approvedAmount ?? challenge.request.cap,
                  initMultiDelegateTx: options.initMultiDelegateTx ?? randomBase64(64),
                  owner: options.owner ?? randomBase58(32),
                  signature,
                  tokenAccount: options.tokenAccount ?? session.channelId,
                  updateDelegationTx: options.updateDelegationTx,
              })
            : session.openAction(options.deposit ?? challenge.request.cap, signature, {
                  mode,
                  transaction: options.transaction,
              });

        return {
            payload,
            session,
            source: options.source,
        };
    };
}

export declare namespace createEphemeralSessionOpener {
    interface Options {
        readonly approvedAmount?: AmountLike | undefined;
        readonly cumulative?: AmountLike | undefined;
        readonly deposit?: AmountLike | undefined;
        readonly expiresAt?: AmountLike | undefined;
        readonly initMultiDelegateTx?: string | undefined;
        readonly mode?: SessionMode | undefined;
        readonly owner?: string | undefined;
        readonly signature?: string | undefined;
        readonly source?: string | undefined;
        readonly tokenAccount?: string | undefined;
        readonly transaction?: string | undefined;
        readonly updateDelegationTx?: string | undefined;
    }
}

/**
 * Returns a request preparation hook that removes sensitive headers before
 * forwarding traffic through a payment gateway.
 */
export function stripRequestHeaders(names: readonly string[]): PrepareSessionRequest {
    const normalized = names.map(name => name.toLowerCase());
    return request => {
        const headers = new Headers(request.init?.headers);
        for (const name of normalized) {
            headers.delete(name);
        }
        return {
            ...request,
            init: {
                ...request.init,
                headers,
            },
        };
    };
}

let globalFetchPatchLock: Promise<void> = Promise.resolve();

/**
 * Temporarily patches `globalThis.fetch` while an SDK that does not accept a
 * fetch option performs its work.
 */
export async function withPatchedGlobalFetch<Value>(
    patchedFetch: typeof globalThis.fetch,
    operation: () => Promise<Value>,
): Promise<Value> {
    let release: () => void = () => undefined;
    const previous = globalFetchPatchLock;
    globalFetchPatchLock = new Promise<void>(resolve => {
        release = resolve;
    });

    await previous;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = patchedFetch;
    try {
        return await operation();
    } finally {
        globalThis.fetch = originalFetch;
        release();
    }
}

function withAuthorization(init: FetchInit, authorization: string): FetchInit {
    const headers = new Headers(init?.headers);
    headers.set('authorization', authorization);
    return { ...init, headers };
}

function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

function cloneFetchInput(input: FetchInput): FetchInput {
    return input instanceof Request ? input.clone() : input;
}

function requestUrl(input: FetchInput): string {
    if (input instanceof Request) return input.url;
    return String(input);
}

function defaultDeliveryId(): string {
    return `mpp-${randomBase58(16)}`;
}

function randomBase58(length: number): string {
    return getBase58Decoder().decode(randomBytes(length));
}

function randomBase64(length: number): string {
    return bytesToBase64(randomBytes(length));
}

function randomBytes(length: number): Uint8Array {
    const crypto = globalThis.crypto;
    if (!crypto?.getRandomValues) {
        throw new Error('crypto.getRandomValues is not available');
    }
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    if (typeof globalThis.btoa === 'function') {
        return globalThis.btoa(binary);
    }

    const buffer = (globalThis as { Buffer?: { from(bytes: Uint8Array): { toString(encoding: string): string } } })
        .Buffer;
    if (!buffer) {
        throw new Error('No base64 encoder is available');
    }
    return buffer.from(bytes).toString('base64');
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

function parseInteger(value: AmountLike, name: string): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
        return BigInt(value);
    }
    if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer string`);
    return BigInt(value);
}
