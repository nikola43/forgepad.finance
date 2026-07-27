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

/// 0 = nothing to do, 1 = start a round (needs the shares API), 2 = pay it out.
const posterAbi = parseAbi(["function work() view returns (uint8)"]);
const WORK_NONE = 0;
const WORK_START_ROUND = 1;
const WORK_DISTRIBUTE = 2;

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

  const readWork = (): number => {
    const reply = evm
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: cfg.receiver,
          data: encodeFunctionData({ abi: posterAbi, functionName: "work" }),
        }),
        blockNumber: LATEST_BLOCK_NUMBER,
      })
      .result();
    return Number(
      decodeFunctionResult({
        abi: posterAbi,
        functionName: "work",
        data: bytesToHex(reply.data),
      }),
    );
  };

  // 1. Free on-chain read: only pay for a report when there is actually work.
  //    The weekly cron fires on a window of ticks, so most of them stop here.
  const work = readWork();
  if (work === WORK_NONE) {
    runtime.log("nothing to do — skipping");
    return "not due";
  }

  // 2. Payout tick: the round's shares and VRF word are both committed on-chain,
  //    so no API call and no consensus round is needed — the payload is ignored
  //    by onReport, which re-derives the job from chain state.
  //    (This replaces Chainlink Automation, which sunsets 2026-07-31.)
  let payload: Hex;
  let what: string;
  if (work === WORK_DISTRIBUTE) {
    payload = encodeAbiParameters(
      [{ type: "uint64" }, { type: "uint64" }, { type: "bytes" }],
      [0n, 0n, "0x"],
    );
    what = "distribute";
  } else {
    // 3. New round: top-100 leaderboard shares for the window [backend epoch, now].
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
    payload = encodeAbiParameters(
      [{ type: "uint64" }, { type: "uint64" }, { type: "bytes" }],
      [BigInt(shares.from), BigInt(shares.to), shares.packed],
    );
    what = `round for window ${shares.from}-${shares.to}`;
  }

  // 4. Deliver the report to CREPoster.onReport: startRound + postShares on a
  //    WORK_START_ROUND tick, distribute() on a WORK_DISTRIBUTE one.
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
  // txStatus only says the FORWARDER tx succeeded. KeystoneForwarder swallows
  // receiver reverts, so an out-of-gas / paused / rejected onReport looks exactly
  // like a delivered round. work() moving off the job we just did is the only
  // proof it landed; if it is unchanged, fail loudly instead of re-sending (and
  // re-paying for) the same doomed report on every tick of the window.
  if (readWork() === work) {
    throw new Error(
      `report delivered (tx ${tx}) but ${what} did not happen — onReport reverted (gas limit ${cfg.gasLimit}? paused? shares rejected?)`,
    );
  }
  runtime.log(`${what} driven, tx ${tx}`);
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
