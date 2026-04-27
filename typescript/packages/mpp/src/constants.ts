export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';

export const USDC: Record<string, string> = {
    devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

export const USDT: Record<string, string> = {
    'mainnet-beta': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

export const PYUSD: Record<string, string> = {
    devnet: 'CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM',
    'mainnet-beta': '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
};

export const CASH: Record<string, string> = {
    'mainnet-beta': 'CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH',
};

export const STABLECOIN_MINTS = {
    CASH,
    PYUSD,
    USDC,
    USDT,
} as const;

export const DEFAULT_RPC_URLS: Record<string, string> = {
    devnet: 'https://api.devnet.solana.com',
    localnet: 'http://localhost:8899',
    'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

export function resolveStablecoinMint(currency: string, network = 'mainnet-beta'): string | undefined {
    switch (currency.toUpperCase()) {
        case 'SOL':
            return undefined;
        case 'USDC':
            return USDC[network] ?? USDC['mainnet-beta'];
        case 'USDT':
            return USDT[network] ?? USDT['mainnet-beta'];
        case 'PYUSD':
            return PYUSD[network] ?? PYUSD['mainnet-beta'];
        case 'CASH':
            return CASH[network] ?? CASH['mainnet-beta'];
        default:
            return currency;
    }
}

export function defaultTokenProgramForCurrency(currency: string | undefined, network = 'mainnet-beta'): string {
    const resolvedMint = currency ? resolveStablecoinMint(currency, network) : undefined;
    return resolvedMint === CASH[network] || resolvedMint === CASH['mainnet-beta'] ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
}

export function stablecoinSymbolForCurrency(currency: string): string | undefined {
    const normalized = currency.toUpperCase();
    if (normalized in STABLECOIN_MINTS) return normalized;

    for (const [symbol, mints] of Object.entries(STABLECOIN_MINTS)) {
        if (Object.values(mints).includes(currency)) return symbol;
    }
}
