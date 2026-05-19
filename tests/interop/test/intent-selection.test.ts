import { describe, expect, it } from "vitest";
import { selectInteropIntents } from "../src/contracts";

describe("interop intent selection", () => {
  it("defaults to the implemented charge scenario", () => {
    expect(selectInteropIntents(undefined)).toEqual(["charge"]);
  });

  it("accepts the implemented charge scenario", () => {
    expect(selectInteropIntents(" charge ")).toEqual(["charge"]);
  });

  it("rejects scenarios that are not implemented yet", () => {
    expect(() => selectInteropIntents("session")).toThrow(/Unsupported MPP_INTEROP_INTENTS/);
  });
});
