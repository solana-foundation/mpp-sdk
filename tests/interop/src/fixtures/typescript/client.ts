import { createKeyPairSignerFromBytes } from "@solana/kit";
import { Mppx, solana } from "@solana/mpp/client";
import { fixtureSettlementHeader, readInteropEnvironment } from "./shared";

async function main() {
  const targetUrl = process.env.MPP_INTEROP_TARGET_URL;
  if (!targetUrl) {
    throw new Error("MPP_INTEROP_TARGET_URL is required");
  }

  const environment = readInteropEnvironment();
  const signer = await createKeyPairSignerFromBytes(environment.clientSecretKey);
  const client = Mppx.create({
    methods: [
      solana.charge({
        signer,
        rpcUrl: environment.rpcUrl,
      }),
    ],
  });

  const paidResponse = await client.fetch(targetUrl);
  const rawBody = await paidResponse.text();
  let responseBody: unknown = rawBody;
  try {
    responseBody = JSON.parse(rawBody);
  } catch {
    // Keep raw string when the response body is not JSON.
  }

  console.log(
    JSON.stringify({
      type: "result",
      implementation: "typescript",
      role: "client",
      ok: paidResponse.ok,
      status: paidResponse.status,
      responseHeaders: Object.fromEntries(paidResponse.headers.entries()),
      responseBody,
      settlement: paidResponse.headers.get(fixtureSettlementHeader),
    }),
  );
}

void main();
