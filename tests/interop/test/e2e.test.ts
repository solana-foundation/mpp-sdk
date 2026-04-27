import net from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSolanaRpc } from "@solana/kit";
import { Surfnet } from "surfpool-sdk";
import { interopScenario } from "../src/contracts";
import { clientImplementations, serverImplementations } from "../src/implementations";
import { runClient, startServer, stopServer } from "../src/process";

type RunningServer = Awaited<ReturnType<typeof startServer>>;

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MINT_ACCOUNT_SIZE = 82;

const runningServers: RunningServer[] = [];

let surfnet: Surfnet | undefined;
let interopEnv: Record<string, string> | undefined;

async function canBindLocalSocket(): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(0, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function getTokenBalance(surfnet: Surfnet, owner: string, mint: string): Promise<bigint> {
  const rpc = createSolanaRpc(surfnet.rpcUrl);
  const ata = surfnet.getAta(owner, mint);
  const response = await rpc.getTokenAccountBalance(ata as never).send();
  return BigInt(response.value.amount);
}

function createSplMintAccountData(decimals: number): Uint8Array {
  const data = new Uint8Array(MINT_ACCOUNT_SIZE);
  const view = new DataView(data.buffer);
  view.setBigUint64(36, 0n, true);
  data[44] = decimals;
  data[45] = 1;
  return data;
}

const socketSupport = await canBindLocalSocket();

beforeAll(async () => {
  if (!socketSupport) {
    return;
  }

  surfnet = Surfnet.start();

  const client = Surfnet.newKeypair();
  const payTo = Surfnet.newKeypair();

  surfnet.setAccount(interopScenario.asset, 1_461_600, createSplMintAccountData(6), TOKEN_PROGRAM);
  surfnet.fundToken(client.publicKey, interopScenario.asset, 100_000);
  surfnet.fundToken(payTo.publicKey, interopScenario.asset, 1);

  interopEnv = {
    MPP_INTEROP_RPC_URL: surfnet.rpcUrl,
    MPP_INTEROP_NETWORK: interopScenario.network,
    MPP_INTEROP_MINT: interopScenario.asset,
    MPP_INTEROP_PRICE: interopScenario.price,
    MPP_INTEROP_SECRET_KEY: "mpp-interop-secret-key",
    MPP_INTEROP_PAY_TO: payTo.publicKey,
    MPP_INTEROP_CLIENT_SECRET_KEY: JSON.stringify(Array.from(client.secretKey)),
    MPP_INTEROP_FEE_PAYER_SECRET_KEY: JSON.stringify(Array.from(surfnet.payerSecretKey)),
  };
});

afterEach(async () => {
  while (runningServers.length > 0) {
    const server = runningServers.pop();
    if (server) {
      await stopServer(server);
    }
  }
});

describe("mpp interop", () => {
  const activeServers = serverImplementations.filter(implementation => implementation.enabled);
  const activeClients = clientImplementations.filter(implementation => implementation.enabled);
  const socketAwareIt = socketSupport ? it : it.skip;

  for (const serverImplementation of activeServers) {
    for (const clientImplementation of activeClients) {
      socketAwareIt(`${clientImplementation.id} client pays ${serverImplementation.id} server`, async () => {
        if (!surfnet || !interopEnv) {
          throw new Error("Surfpool interop environment was not initialized");
        }

        const initialBalance = await getTokenBalance(
          surfnet,
          interopEnv.MPP_INTEROP_PAY_TO,
          interopEnv.MPP_INTEROP_MINT,
        );

        const server = await startServer(serverImplementation, interopEnv);
        runningServers.push(server);

        const targetUrl = `http://127.0.0.1:${server.ready.port}${interopScenario.resourcePath}`;
        const result = await runClient(clientImplementation, targetUrl, interopEnv);

        const finalBalance = await getTokenBalance(
          surfnet,
          interopEnv.MPP_INTEROP_PAY_TO,
          interopEnv.MPP_INTEROP_MINT,
        );

        expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
        expect(result.status).toBe(200);
        expect(result.responseBody).toMatchObject({
          ok: true,
          paid: true,
        });
        expect(typeof result.settlement).toBe("string");
        expect(result.settlement).not.toHaveLength(0);
        expect(finalBalance - initialBalance).toBe(BigInt(interopScenario.amount));
      });
    }
  }
});
