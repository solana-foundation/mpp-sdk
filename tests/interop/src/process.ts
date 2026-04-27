import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import type { AdapterMessage, ClientRunResult, ReadyMessage } from "./contracts";
import type { ImplementationDefinition } from "./implementations";

type RunningServer = {
  child: ChildProcess;
  ready: ReadyMessage;
};

const ADAPTER_OUTPUT_TIMEOUT_MS = 120_000;

async function waitForJsonMessage<T extends AdapterMessage>(
  child: ChildProcess,
  timeoutMs: number,
): Promise<T> {
  if (!child.stdout) {
    throw new Error("Spawned process does not expose stdout");
  }

  const readline = createInterface({ input: child.stdout });

  try {
    return await Promise.race([
      new Promise<T>((resolve, reject) => {
        readline.on("line", line => {
          if (!line.trim()) {
            return;
          }

          try {
            resolve(JSON.parse(line) as T);
          } catch (error) {
            reject(
              new Error(`Failed to parse adapter output as JSON: ${line}\n${String(error)}`),
            );
          }
        });

        child.once("exit", code => {
          reject(new Error(`Adapter exited before signaling readiness/result (code ${code ?? -1})`));
        });
      }),
      delay(timeoutMs).then(() => {
        throw new Error(`Timed out waiting for adapter output after ${timeoutMs}ms`);
      }),
    ]);
  } finally {
    readline.close();
  }
}

function spawnAdapter(
  implementation: ImplementationDefinition,
  extraEnv: Record<string, string> = {},
): ChildProcess {
  const [command, ...args] = implementation.command;
  return spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
}

export async function startServer(
  implementation: ImplementationDefinition,
  extraEnv: Record<string, string> = {},
): Promise<RunningServer> {
  const child = spawnAdapter(implementation, extraEnv);
  const ready = await waitForJsonMessage<ReadyMessage>(child, ADAPTER_OUTPUT_TIMEOUT_MS);

  if (ready.type !== "ready" || ready.role !== "server" || !ready.port) {
    child.kill("SIGTERM");
    throw new Error(`Unexpected server readiness payload from ${implementation.id}`);
  }

  return { child, ready };
}

export async function runClient(
  implementation: ImplementationDefinition,
  targetUrl: string,
  extraEnv: Record<string, string> = {},
): Promise<ClientRunResult> {
  const child = spawnAdapter(implementation, {
    MPP_INTEROP_TARGET_URL: targetUrl,
    ...extraEnv,
  });

  const result = await waitForJsonMessage<ClientRunResult>(child, ADAPTER_OUTPUT_TIMEOUT_MS);
  await new Promise<void>((resolve, reject) => {
    child.once("exit", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Client adapter exited with code ${code ?? -1}`));
      }
    });
  });

  if (result.type !== "result" || result.role !== "client") {
    throw new Error(`Unexpected client result payload from ${implementation.id}`);
  }

  return result;
}

export async function stopServer(server: RunningServer): Promise<void> {
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>(resolve => {
      server.child.once("exit", () => resolve());
    }),
    delay(5_000).then(() => {
      server.child.kill("SIGKILL");
    }),
  ]);
}
