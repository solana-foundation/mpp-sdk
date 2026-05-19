import { interopScenario } from "../../contracts";

export type InteropEnvironment = {
  rpcUrl: string;
  network: string;
  mint: string;
  amount: string;
  resourcePath: string;
  settlementHeader: string;
  payTo: string;
  secretKey: string;
  splits: Array<{
    recipient: string;
    amount: string;
    ataCreationRequired?: boolean;
    memo?: string;
  }>;
  clientSecretKey: Uint8Array;
  feePayerSecretKey: Uint8Array;
};

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required`);
  }

  return value;
}

function parseSecretKey(name: string): Uint8Array {
  const raw = readRequiredEnv(name);
  const parsed = JSON.parse(raw) as number[];
  return new Uint8Array(parsed);
}

export function readInteropEnvironment(): InteropEnvironment {
  return {
    rpcUrl: readRequiredEnv("MPP_INTEROP_RPC_URL"),
    network: process.env.MPP_INTEROP_NETWORK ?? interopScenario.network,
    mint: process.env.MPP_INTEROP_MINT ?? interopScenario.asset,
    amount: process.env.MPP_INTEROP_AMOUNT ?? interopScenario.amount,
    resourcePath:
      process.env.MPP_INTEROP_RESOURCE_PATH ?? interopScenario.resourcePath,
    settlementHeader:
      process.env.MPP_INTEROP_SETTLEMENT_HEADER ??
      interopScenario.settlementHeader,
    payTo: readRequiredEnv("MPP_INTEROP_PAY_TO"),
    secretKey: process.env.MPP_INTEROP_SECRET_KEY ?? "mpp-interop-secret-key",
    splits: JSON.parse(
      process.env.MPP_INTEROP_SPLITS ?? "[]",
    ) as InteropEnvironment["splits"],
    clientSecretKey: parseSecretKey("MPP_INTEROP_CLIENT_SECRET_KEY"),
    feePayerSecretKey: parseSecretKey("MPP_INTEROP_FEE_PAYER_SECRET_KEY"),
  };
}

export const fixtureSettlementHeader = interopScenario.settlementHeader;
