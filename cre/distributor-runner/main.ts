import {
  CronCapability,
  EVMClient,
  HTTPClient,
  type HTTPSendRequester,
  LATEST_BLOCK_NUMBER,
  Runner,
  type Runtime,
  TxStatus,
  bytesToHex,
  consensusIdenticalAggregation,
  encodeCallMsg,
  handler,
  json,
  prepareReportRequest,
} from "@chainlink/cre-sdk";
import {
  type Hex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
} from "viem";

export type Config = {
  schedule: string;
  /** Backend base URL serving GET /distributor/shares */
  apiUrl: string;
  /** CRE chain name, e.g. binance_smart_chain-testnet */
  chainName: string;
  /** CREPoster receiver contract (set as the Distributor's poster) */
  receiver: Hex;
  gasLimit: string;
};

const posterAbi = parseAbi(["function ready() view returns (bool)"]);

type Shares = { from: number; to: number; packed: Hex };

/// Runs on every node, result must agree across the DON (identical consensus).
/// The response is deterministic for a fixed query because `to` is pinned by
/// the workflow; a trade indexed mid-query on one node just fails this tick and
/// the next 5-minute tick retries.
const fetchShares = (req: HTTPSendRequester, url: string): string => {
  const resp = req.sendRequest({ url, method: "GET" }).result();
  if (resp.statusCode !== 200) {
    throw new Error(`shares API returned ${resp.statusCode}`);
  }
  const body = json(resp) as Shares;
  // canonical string so identical-aggregation compares cleanly
  return JSON.stringify({ from: body.from, to: body.to, packed: body.packed });
};

export const onCronTrigger = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config;
  const selector =
    EVMClient.SUPPORTED_CHAIN_SELECTORS[
      cfg.chainName as keyof typeof EVMClient.SUPPORTED_CHAIN_SELECTORS
    ];
  if (!selector) throw new Error(`unsupported chain: ${cfg.chainName}`);
  const evm = new EVMClient(selector);

  // 1. Free on-chain read: only pay for a report when a round is actually due
  //    (period elapsed, pot funded, no round in flight).
  const readyReply = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: cfg.receiver,
        data: encodeFunctionData({ abi: posterAbi, functionName: "ready" }),
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  const isReady = decodeFunctionResult({
    abi: posterAbi,
    functionName: "ready",
    data: bytesToHex(readyReply.data),
  });
  if (!isReady) {
    runtime.log("round not due — skipping");
    return "not due";
  }

  // 2. Top-100 leaderboard shares for the window [backend epoch, now].
  const to = Math.floor(runtime.now().getTime() / 1000);
  const url = `${cfg.apiUrl}/distributor/shares?to=${to}&limit=100`;
  const http = new HTTPClient();
  const sharesJson = http
    .sendRequest(runtime, fetchShares, consensusIdenticalAggregation())(url)
    .result();
  const shares = JSON.parse(sharesJson) as Shares;
  if (!shares.packed || shares.packed === "0x") {
    runtime.log("no eligible holders — skipping");
    return "no holders";
  }

  // 3. Deliver abi.encode(from, to, packed) to CREPoster.onReport, which
  //    drives startRound + postShares; Chainlink Automation then distributes
  //    once VRF lands.
  const payload = encodeAbiParameters(
    [{ type: "uint64" }, { type: "uint64" }, { type: "bytes" }],
    [BigInt(shares.from), BigInt(shares.to), shares.packed],
  );
  const report = runtime.report(prepareReportRequest(payload)).result();
  const write = evm
    .writeReport(runtime, {
      receiver: cfg.receiver,
      report,
      gasConfig: { gasLimit: cfg.gasLimit },
    })
    .result();
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(
      `writeReport failed (${TxStatus[write.txStatus]}): ${write.errorMessage ?? ""}`,
    );
  }
  const tx = write.txHash ? bytesToHex(write.txHash) : "unknown";
  runtime.log(`round driven for window ${shares.from}-${shares.to}, tx ${tx}`);
  return tx;
};

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
