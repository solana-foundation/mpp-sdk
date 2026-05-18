/**
 * Tests for client/Methods.ts and client/index.ts exports.
 *
 * Validates that the client barrel modules expose the expected public API.
 */
import { solana } from '../client/Methods.js';
import {
    ActiveSession,
    charge,
    createSessionUsageMeter,
    HttpCommitTransport,
    SessionConsumer,
    SessionUsageMeter,
    selectSolanaChargeChallenge,
    selectSolanaChargeChallengeFromResponse,
    session,
    solana as solanaFromIndex,
    voucherMessageBytes,
} from '../client/index.js';

describe('client/Methods.ts', () => {
    test('solana is a callable function', () => {
        expect(typeof solana).toBe('function');
    });

    test('solana.charge is a function', () => {
        expect(typeof solana.charge).toBe('function');
    });

    test('solana.session is a function', () => {
        expect(typeof solana.session).toBe('function');
    });
});

describe('client/index.ts', () => {
    test('exports charge function', () => {
        expect(typeof charge).toBe('function');
    });

    test('exports session devex helpers', () => {
        expect(typeof session).toBe('function');
        expect(typeof ActiveSession).toBe('function');
        expect(typeof SessionConsumer).toBe('function');
        expect(typeof SessionUsageMeter).toBe('function');
        expect(typeof createSessionUsageMeter).toBe('function');
        expect(typeof HttpCommitTransport).toBe('function');
        expect(typeof voucherMessageBytes).toBe('function');
    });

    test('exports solana namespace', () => {
        expect(typeof solanaFromIndex).toBe('function');
        expect(solanaFromIndex).toBe(solana);
        expect(solanaFromIndex.session).toBe(solana.session);
    });

    test('exports challenge selectors', () => {
        expect(typeof selectSolanaChargeChallenge).toBe('function');
        expect(typeof selectSolanaChargeChallengeFromResponse).toBe('function');
        expect(solanaFromIndex.selectChargeChallenge).toBe(selectSolanaChargeChallenge);
    });
});
