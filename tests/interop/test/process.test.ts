import { afterEach, describe, expect, it } from "vitest";
import type { ImplementationDefinition } from "../src/implementations";
import { runClient, startServer, stopServer } from "../src/process";

function adapter(
  role: ImplementationDefinition["role"],
  id: string,
  script: string,
): ImplementationDefinition {
  return {
    id,
    label: `${id} test adapter`,
    role,
    command: [process.execPath, "-e", script],
    enabled: true,
  };
}

describe("process adapter diagnostics", () => {
  const originalAdapterTimeout = process.env.MPP_INTEROP_ADAPTER_TIMEOUT_MS;

  afterEach(() => {
    if (originalAdapterTimeout === undefined) {
      delete process.env.MPP_INTEROP_ADAPTER_TIMEOUT_MS;
    } else {
      process.env.MPP_INTEROP_ADAPTER_TIMEOUT_MS = originalAdapterTimeout;
    }
  });

  it("includes adapter identity when stdout is not JSON", async () => {
    await expect(
      startServer(adapter("server", "bad-json", 'console.log("not json")')),
    ).rejects.toThrow(/Failed to parse server adapter bad-json/);
  });

  it("rejects server adapters that report the wrong implementation id", async () => {
    await expect(
      startServer(
        adapter(
          "server",
          "expected-server",
          'console.log(JSON.stringify({ type: "ready", implementation: "other-server", role: "server", port: 12345 }))',
        ),
      ),
    ).rejects.toThrow(/reported implementation other-server/);
  });

  it("includes recent stderr when an adapter exits before a message", async () => {
    await expect(
      runClient(adapter("client", "stderr-client", 'console.error("adapter exploded"); process.exit(7)'), "http://127.0.0.1"),
    ).rejects.toThrow(/adapter exploded/);
  });

  it("uses MPP_INTEROP_ADAPTER_TIMEOUT_MS for local timeout debugging", async () => {
    process.env.MPP_INTEROP_ADAPTER_TIMEOUT_MS = "10";

    await expect(
      startServer(adapter("server", "silent-server", "setInterval(() => {}, 1000)")),
    ).rejects.toThrow(/Timed out waiting for server adapter silent-server .* after 10ms/);
  });

  it("rejects invalid MPP_INTEROP_ADAPTER_TIMEOUT_MS values", async () => {
    process.env.MPP_INTEROP_ADAPTER_TIMEOUT_MS = "not-a-number";

    await expect(
      startServer(adapter("server", "timeout-config-server", "setInterval(() => {}, 1000)")),
    ).rejects.toThrow(/MPP_INTEROP_ADAPTER_TIMEOUT_MS must be a positive integer/);
  });


  it("rejects client adapters that report the wrong implementation id", async () => {
    await expect(
      runClient(
        adapter(
          "client",
          "expected-client",
          'console.log(JSON.stringify({ type: "result", implementation: "other-client", role: "client", ok: true, status: 200, responseHeaders: {}, responseBody: {} }))',
        ),
        "http://127.0.0.1",
      ),
    ).rejects.toThrow(/reported implementation other-client/);
  });

  it("includes adapter identity when a client exits nonzero after a result", async () => {
    await expect(
      runClient(
        adapter(
          "client",
          "late-fail-client",
          'console.error("late failure"); console.log(JSON.stringify({ type: "result", implementation: "late-fail-client", role: "client", ok: true, status: 200, responseHeaders: {}, responseBody: {} })); process.exit(9)',
        ),
        "http://127.0.0.1",
      ),
    ).rejects.toThrow(/client adapter late-fail-client .*exited with code 9[\s\S]*late failure/);
  });

  it("stops a started test server adapter", async () => {
    const server = await startServer(
      adapter(
        "server",
        "stoppable-server",
        'console.log(JSON.stringify({ type: "ready", implementation: "stoppable-server", role: "server", port: 12345 })); setInterval(() => {}, 1000)',
      ),
    );

    await stopServer(server);
  });
});
