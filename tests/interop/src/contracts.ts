export type AdapterKind = "client" | "server";

export type InteropScenario = {
  intent: "charge";
  network: string;
  price: string;
  amount: string;
  asset: string;
  resourcePath: string;
  settlementHeader: string;
};

export type ReadyMessage = {
  type: "ready";
  implementation: string;
  role: AdapterKind;
  port?: number;
  capabilities?: string[];
};

export type ClientRunResult = {
  type: "result";
  implementation: string;
  role: "client";
  ok: boolean;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  settlement?: unknown;
};

export type AdapterMessage = ReadyMessage | ClientRunResult;

export const interopScenario: InteropScenario = {
  intent: "charge",
  network: "localnet",
  price: "0.001",
  amount: "1000",
  asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  resourcePath: "/protected",
  settlementHeader: "x-fixture-settlement",
};
