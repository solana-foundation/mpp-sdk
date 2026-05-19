export type AdapterKind = "client" | "server";

export type InteropIntent = "charge";

export type InteropScenario = {
  intent: InteropIntent;
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

export const supportedInteropIntents: readonly InteropIntent[] = [interopScenario.intent];

export function selectInteropIntents(rawSelection: string | undefined): InteropIntent[] {
  if (!rawSelection || rawSelection.trim() === "") {
    return [...supportedInteropIntents];
  }

  const selected = rawSelection
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const unsupported = selected.filter(value => !supportedInteropIntents.includes(value as never));

  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported MPP_INTEROP_INTENTS value(s): ${unsupported.join(", ")}. ` +
        `Supported intents: ${supportedInteropIntents.join(", ")}. ` +
        "Session and subscription scenarios are not implemented in this harness yet.",
    );
  }

  return selected as InteropIntent[];
}
