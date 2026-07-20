import { describe, expect, test } from "bun:test";
import { decodeAbiParameters, encodeAbiParameters } from "viem";
import { initWorkflow } from "./main";
import type { Config } from "./main";

const config: Config = {
  schedule: "0 */5 * * * *",
  apiUrl: "http://localhost:5002",
  chainName: "binance_smart_chain-testnet",
  receiver: "0x0000000000000000000000000000000000000000",
  gasLimit: "2000000",
};

describe("initWorkflow", () => {
  test("wires one cron handler with the configured schedule", () => {
    const handlers = initWorkflow(config);
    expect(handlers).toHaveLength(1);
    expect(handlers[0].trigger.config.schedule).toBe(config.schedule);
  });
});

describe("report payload", () => {
  test("uint64,uint64,bytes layout round-trips (matches CREPoster abi.decode)", () => {
    // 1 holder entry: 20-byte address ++ big-endian uint32 share (100%)
    const packed = `0x${"11".repeat(20)}ffffffff` as const;
    const encoded = encodeAbiParameters(
      [{ type: "uint64" }, { type: "uint64" }, { type: "bytes" }],
      [1751000000n, 1751000300n, packed],
    );
    const [from, to, shares] = decodeAbiParameters(
      [{ type: "uint64" }, { type: "uint64" }, { type: "bytes" }],
      encoded,
    );
    expect(from).toBe(1751000000n);
    expect(to).toBe(1751000300n);
    expect(shares).toBe(packed);
  });
});
