import { Challenge } from 'mppx';

import {
    createEphemeralSessionOpener,
    createSessionFetch,
    createSessionUsageMeter,
    DEFAULT_SESSION_EXPIRES_AT,
    stripRequestHeaders,
    type SessionChallenge,
    type SessionFetchEvent,
} from '../client/index.js';

type FetchInit = Parameters<typeof globalThis.fetch>[1];

const recipient = 'CXhrFZJLKqjzmP3sjYLcF4dTeXWKCy9e2SXXZ2Yo6MPY';

interface CommitLog {
    readonly amount: string;
    readonly authorization: string | null;
    readonly deliveryId: string;
}

interface DeliveryLog {
    readonly amount: string;
    readonly commitUrl: string;
    readonly deliveryId: string;
    readonly sessionId: string;
}

interface SessionGatewayMock {
    readonly commits: CommitLog[];
    readonly deliveries: DeliveryLog[];
    readonly fetch: typeof globalThis.fetch;
    retryCount: number;
}

function sessionChallenge(overrides: Partial<SessionChallenge['request']> = {}): SessionChallenge {
    return {
        id: 'gemini-session',
        intent: 'session',
        method: 'solana',
        realm: 'test',
        request: {
            cap: '1000000',
            currency: 'USDC',
            decimals: 6,
            minVoucherDelta: '1',
            modes: ['pull'],
            network: 'localnet',
            operator: recipient,
            recipient,
            ...overrides,
        },
    };
}

function createSessionGatewayMock(): SessionGatewayMock {
    const commits: CommitLog[] = [];
    const deliveries: DeliveryLog[] = [];
    let committedCumulative = 0n;
    const gateway: SessionGatewayMock = {
        commits,
        deliveries,
        fetch: async (input, init) => {
            const url = new URL(fetchUrl(input));
            const headers = new Headers(init?.headers);

            if (url.pathname === '/v1/generate') {
                if (!headers.has('authorization')) {
                    return new Response(null, {
                        headers: {
                            'WWW-Authenticate': Challenge.serialize(sessionChallenge()),
                        },
                        status: 402,
                    });
                }

                gateway.retryCount += 1;
                return new Response('ok', { status: 200 });
            }

            if (url.pathname === '/__402/session/deliveries') {
                const body = parseJsonBody(init);
                const delivery: DeliveryLog = {
                    amount: expectString(body.amount),
                    commitUrl: expectString(body.commitUrl),
                    deliveryId: expectString(body.deliveryId),
                    sessionId: expectString(body.sessionId),
                };
                deliveries.push(delivery);
                return Response.json({
                    amount: delivery.amount,
                    commitUrl: 'https://api.test/session/commit',
                    currency: 'USDC',
                    deliveryId: delivery.deliveryId,
                    expiresAt: DEFAULT_SESSION_EXPIRES_AT,
                    sequence: deliveries.length,
                    sessionId: delivery.sessionId,
                });
            }

            if (url.pathname === '/session/commit') {
                const body = parseJsonBody(init);
                const amount = expectString(body.amount);
                committedCumulative += BigInt(amount);
                commits.push({
                    amount,
                    authorization: headers.get('authorization'),
                    deliveryId: expectString(body.deliveryId),
                });
                return Response.json({
                    amount,
                    cumulative: committedCumulative.toString(),
                    deliveryId: expectString(body.deliveryId),
                    sessionId: deliveries.at(-1)?.sessionId ?? 'unknown',
                    status: 'committed',
                });
            }

            return new Response(`unexpected ${url.href}`, { status: 500 });
        },
        retryCount: 0,
    };

    return gateway;
}

describe('SessionUsageMeter', () => {
    test('opens a session through patched fetch and commits throttled cumulative usage', async () => {
        const gateway = createSessionGatewayMock();
        const events: SessionFetchEvent[] = [];
        const client = createSessionFetch({
            fetch: gateway.fetch,
            liveCommitIntervalMs: 60_000,
            onEvent: event => events.push(event),
            opener: createEphemeralSessionOpener({ mode: 'pull' }),
            prepareRequest: stripRequestHeaders(['x-goog-api-key']),
        });
        const meter = createSessionUsageMeter<number>({
            client,
            priceUsage: (tokens, context) => ({
                cumulativeAmount: (BigInt(context.baselineCumulativeAmount) + BigInt(tokens)).toString(),
                deltaAmount: tokens.toString(),
            }),
        });

        expect(meter.client).toBe(client);
        const response = await meter.withPatchedFetch(async () => {
            return await fetch('https://api.test/v1/generate', {
                headers: {
                    'x-goog-api-key': 'secret',
                },
            });
        });

        expect(response.status).toBe(200);
        expect(gateway.retryCount).toBe(1);
        expect(meter.baselineCumulativeAmount).toBeUndefined();
        expect(meter.recordUsage(10)).toBe(true);
        expect(meter.recordUsage(10)).toBe(false);
        expect(meter.recordUsage(25)).toBe(true);

        const receipt = await meter.flush();

        expect(receipt).toMatchObject({ amount: '15', cumulative: '25', status: 'committed' });
        expect(gateway.deliveries.map(delivery => delivery.amount)).toEqual(['10', '15']);
        expect(gateway.commits.map(commit => commit.amount)).toEqual(['10', '15']);
        expect(gateway.commits.every(commit => commit.authorization?.startsWith('Payment '))).toBe(true);
        expect(events.map(event => event.type)).toEqual([
            'challenge',
            'open',
            'retry',
            'watermark',
            'watermark',
            'commit',
            'commit',
        ]);
        expect(client.cumulativeAmount).toBe('25');
    });

    test('resets the operation baseline while reusing an open session', async () => {
        const gateway = createSessionGatewayMock();
        const client = createSessionFetch({
            fetch: gateway.fetch,
            opener: createEphemeralSessionOpener({ mode: 'pull' }),
        });
        const meter = createSessionUsageMeter<number>({
            client,
            priceUsage: (tokens, context) => ({
                cumulativeAmount: BigInt(context.baselineCumulativeAmount) + BigInt(tokens),
            }),
        });

        await client.fetch('https://api.test/v1/generate');
        await meter.flush(20);

        meter.resetBaseline();
        await meter.flush(5);

        expect(gateway.commits.map(commit => commit.amount)).toEqual(['20', '5']);
        expect(client.cumulativeAmount).toBe('25');
        expect(meter.baselineCumulativeAmount).toBe('20');
    });

    test('ignores usage until a session is open or a price is available', async () => {
        const gateway = createSessionGatewayMock();
        const client = createSessionFetch({
            fetch: gateway.fetch,
            opener: createEphemeralSessionOpener({ mode: 'pull' }),
        });
        const meter = createSessionUsageMeter<number>({
            client,
            priceUsage: () => undefined,
        });

        expect(meter.recordUsage(1)).toBe(false);
        await client.fetch('https://api.test/v1/generate');
        expect(meter.recordUsage(1)).toBe(false);
        expect(await meter.flush()).toBeNull();
        expect(gateway.commits).toHaveLength(0);
    });

    test('rejects unsafe usage price amounts before they reach voucher signing', async () => {
        const gateway = createSessionGatewayMock();
        const client = createSessionFetch({
            fetch: gateway.fetch,
            opener: createEphemeralSessionOpener({ mode: 'pull' }),
        });
        const meter = createSessionUsageMeter<number>({
            client,
            priceUsage: () => ({ cumulativeAmount: -1 }),
        });

        await client.fetch('https://api.test/v1/generate');

        expect(() => meter.recordUsage(1)).toThrow('cumulativeAmount must be non-negative');
        expect(gateway.commits).toHaveLength(0);
    });
});

function fetchUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
    if (input instanceof Request) return input.url;
    return String(input);
}

function parseJsonBody(init: FetchInit): Record<string, unknown> {
    if (typeof init?.body !== 'string') {
        throw new Error('expected JSON string body');
    }
    const parsed: unknown = JSON.parse(init.body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('expected JSON object body');
    }
    return parsed as Record<string, unknown>;
}

function expectString(value: unknown): string {
    if (typeof value !== 'string') {
        throw new Error('expected string');
    }
    return value;
}
