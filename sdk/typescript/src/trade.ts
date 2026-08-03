/**
 * Trading against the bonding curve.
 *
 * This module builds **unsigned transactions**. It never sees a private key,
 * never signs and never broadcasts — it hands you `{ to, data, value }` and you
 * pass that to whatever wallet you already have (viem, ethers, a hardware
 * signer, a multisig UI). That is why `@fyuz/sdk` still has zero runtime
 * dependencies: signing is the part that needs a crypto library, and it is not
 * here. `@fyuz/sdk-trade` adds it if you want it.
 *
 * ```ts
 * const { transaction, quote } = await client.trade.buildBuy({
 *   token: '0x…',
 *   amountWei: parseUnits('0.5'),   // 0.5 BNB
 *   slippageBps: 100,               // 1%
 * });
 *
 * console.log(`expecting ${formatUnits(quote.amountOutWei)} tokens`);
 * await walletClient.sendTransaction(transaction);
 * ```
 *
 * # Quotes come from the contract, not from arithmetic here
 *
 * Every quote is an `eth_call` to `getSwapOutput`. Reimplementing the curve
 * locally would mean a second formula that has to be kept in step with an
 * upgradeable contract, and the day they disagree is the day someone's
 * `minAmountOut` is wrong.
 *
 * # Slippage is never chosen for you
 *
 * {@link TradeClient.buildBuy} and {@link TradeClient.buildSell} require either
 * `slippageBps` or an explicit `minAmountOutWei`. There is no default, because a
 * default is a number picked by someone who cannot see the trade, and being
 * wrong costs the caller money.
 *
 * @module
 */

import {
  SELECTOR_ALLOWANCE,
  SELECTOR_APPROVE,
  SELECTOR_BALANCE_OF,
  SELECTOR_GET_FIRST_BUY_FEE,
  SELECTOR_GET_MAX_SELLABLE_ETH,
  SELECTOR_GET_SWAP_OUTPUT,
  SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS,
  SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS,
  SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH,
  SELECTOR_TOKEN_POOLS,
  UINT256_MAX,
  addressWord,
  boolWord,
  decodeBoolAt,
  decodeUint256At,
  encodeCall,
  normalizeAddress,
  parseWeiAmount,
  uint256Word,
} from './abi.js';
import { FyuzInvalidArgumentError, FyuzTokenGraduatedError } from './errors.js';
import type { HttpClient } from './http.js';
import type { ChainConfig, ChainInfo } from './models/common.js';
import { RpcClient, type RpcClientOptions } from './rpc.js';
import { SELECTOR_ALREADY_LAUNCHED, revertError, revertSelector } from './revert.js';

/** Basis points in 100%. */
const BPS_DIVISOR = 10_000n;

/** Default validity window for a built transaction, in seconds. */
export const DEFAULT_DEADLINE_SECONDS = 120;

/** Chain slug used when a call does not name one. */
export const DEFAULT_NETWORK = 'bsc';

/** A transaction ready to be signed and sent. Every numeric field is 0x-hex. */
export interface UnsignedTransaction {
  /** EIP-155 chain id. Check it before signing — it is what stops a BSC-signed transaction replaying elsewhere. */
  chainId: number;
  /** Contract to call. */
  to: string;
  /** ABI-encoded calldata. */
  data: string;
  /** Native value to attach, in wei, as 0x-hex. `'0x0'` for non-payable calls. */
  value: string;
  /** Sender, when one was supplied. Some wallets require it; gas estimation always does. */
  from?: string;
}

/** What a buy will cost and return, priced against current curve state. */
export interface BuyQuote {
  network: string;
  token: string;
  /** Amount going into the curve, in wei. */
  amountInWei: string;
  /** `getFirstBuyFee(token)`, in wei — charged **on top of** `amountInWei`. */
  firstBuyFeeWei: string;
  /** What `msg.value` must be: `amountInWei + firstBuyFeeWei`. */
  valueWei: string;
  /** Tokens out at the quoted moment, in the token's smallest unit. */
  amountOutWei: string;
  /** Price impact in basis points, as the contract computes it. */
  priceImpactBps: number;
}

/** What a sell will return, priced against current curve state. */
export interface SellQuote {
  network: string;
  token: string;
  /** Tokens going in, in the token's smallest unit. */
  amountInWei: string;
  /** Native currency out, in wei, net of the platform and token-owner fees. */
  amountOutWei: string;
  /** Price impact in basis points, as the contract computes it. */
  priceImpactBps: number;
}

/** A built transaction with the quote it was priced from. */
export interface BuiltTrade<Q> {
  transaction: UnsignedTransaction;
  quote: Q;
  /** The `minAmountOut` (or `maxAmountIn`) actually encoded, in wei. */
  limitWei: string;
  /** Unix seconds after which the contract rejects the swap. */
  deadline: number;
}

/** Shared shape for anything that names a token on a chain. */
interface TokenRef {
  token: string;
  /** Chain slug. Defaults to `"bsc"`. */
  network?: string;
}

/** How far the price may move before the contract should reject the swap. */
interface SlippageOptions {
  /** Tolerance in basis points — `100` is 1%. Mutually exclusive with the explicit limit. */
  slippageBps?: number;
  /** An exact `minAmountOut`/`maxAmountIn` in wei, bypassing the tolerance calculation. */
  limitWei?: string;
  /** Absolute deadline, unix seconds. Wins over `deadlineSeconds`. */
  deadline?: number;
  /** Relative deadline in seconds from now. Defaults to 120. */
  deadlineSeconds?: number;
  /** Sender address, copied onto the transaction. */
  from?: string;
}

export interface BuyOptions extends TokenRef, SlippageOptions {
  /** Native currency to spend, in wei, excluding the first-buy fee. */
  amountWei: string;
}

export interface BuyExactTokensOptions extends TokenRef, SlippageOptions {
  /** Exact tokens wanted, in the token's smallest unit. */
  amountOutWei: string;
}

export interface SellOptions extends TokenRef, SlippageOptions {
  /** Tokens to sell, in the token's smallest unit. */
  amountWei: string;
}

export interface TradeClientOptions {
  /**
   * JSON-RPC endpoint. Defaults to the one `GET /config` publishes for the chain.
   *
   * Pass your own in production. The published endpoint belongs to the API
   * operator, is shared by every caller, and can change without notice.
   */
  rpcUrl?: string;
  /** Per-call RPC timeout in milliseconds. Defaults to 15000. */
  rpcTimeoutMs?: number;
  /** Extra headers for the RPC endpoint, e.g. a provider API key. */
  rpcHeaders?: Record<string, string>;
  /** Injected `fetch`. Defaults to the client's. */
  fetch?: RpcClientOptions['fetch'];
}

/**
 * Builds unsigned bonding-curve transactions.
 *
 * Reached through {@link FyuzClient.trade}; constructing one directly is only
 * useful in tests.
 */
export class TradeClient {
  private readonly http: HttpClient;
  private readonly options: TradeClientOptions;
  private chainsPromise: Promise<ChainInfo[]> | undefined;
  private readonly rpcClients = new Map<string, RpcClient>();

  constructor(http: HttpClient, options: TradeClientOptions = {}) {
    this.http = http;
    this.options = options;
  }

  // ------------------------------------------------------------- Chain setup

  /**
   * Chain metadata from `GET /config`: contract address, chain id, RPC, explorer.
   *
   * Fetched once and memoised — it changes about as often as a redeploy. Build a
   * new client to pick up a change.
   */
  async chain(network: string = DEFAULT_NETWORK): Promise<ChainInfo> {
    this.chainsPromise ??= this.http
      .request<ChainConfig>({ method: 'GET', path: '/config' })
      .then((config) => config.chains);

    const chains = await this.chainsPromise;
    const match = chains.find(
      (chain) => chain.network === network || String(chain.chainId) === network,
    );
    if (match === undefined) {
      const known = chains.map((chain) => chain.network ?? chain.chainId).join(', ');
      throw new FyuzInvalidArgumentError(
        `unknown network ${JSON.stringify(network)}; the API serves: ${known}`,
      );
    }
    if (match.contractAddress === undefined || match.chainId === undefined) {
      throw new FyuzInvalidArgumentError(
        `the API did not publish a contract address for ${network}, so no transaction can be built`,
      );
    }
    return match;
  }

  /** The JSON-RPC client for a chain, built from the override or `/config`. */
  private async rpc(network: string): Promise<RpcClient> {
    const cached = this.rpcClients.get(network);
    if (cached !== undefined) return cached;

    const chain = await this.chain(network);
    const url = this.options.rpcUrl ?? chain.rpcUrl;
    if (url === undefined) {
      throw new FyuzInvalidArgumentError(
        `no RPC endpoint for ${network}: the API published none, and no rpcUrl was configured`,
      );
    }

    const client = new RpcClient({
      url,
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      ...(this.options.rpcTimeoutMs === undefined ? {} : { timeoutMs: this.options.rpcTimeoutMs }),
      ...(this.options.rpcHeaders === undefined ? {} : { headers: this.options.rpcHeaders }),
    });
    this.rpcClients.set(network, client);
    return client;
  }

  // ------------------------------------------------------------------ Reads

  /**
   * Whether the token has left the bonding curve.
   *
   * Reads `tokenPools(token).launched` — the contract's own flag, not the
   * indexer's view of it, so it cannot lag behind a graduation that happened
   * seconds ago.
   */
  async isGraduated(params: TokenRef): Promise<boolean> {
    const network = params.network ?? DEFAULT_NETWORK;
    const token = normalizeAddress('token', params.token);
    const chain = await this.chain(network);
    const rpc = await this.rpc(network);

    const result = await rpc.callRaw({
      to: chain.contractAddress as string,
      data: encodeCall(SELECTOR_TOKEN_POOLS, [addressWord(token)]),
    });
    if (!result.ok) throw revertError(result.revert, `tokenPools(${token})`);

    // (uint256,uint256,uint256,uint256,address,address,uint8,bool) — `launched` last.
    return decodeBoolAt(result.data, 7);
  }

  /** `getFirstBuyFee(token)` in wei — the surcharge on the very first buy of a token. */
  async firstBuyFee(params: TokenRef): Promise<string> {
    const network = params.network ?? DEFAULT_NETWORK;
    const token = normalizeAddress('token', params.token);
    const chain = await this.chain(network);
    const rpc = await this.rpc(network);

    const result = await rpc.callRaw({
      to: chain.contractAddress as string,
      data: encodeCall(SELECTOR_GET_FIRST_BUY_FEE, [addressWord(token)]),
    });
    if (!result.ok) throw revertError(result.revert, `getFirstBuyFee(${token})`);
    return decodeUint256At(result.data, 0).toString();
  }

  /** `getMaxSellableETH(token)` in wei — the ceiling one sell may extract. */
  async maxSellableWei(params: TokenRef): Promise<string> {
    const network = params.network ?? DEFAULT_NETWORK;
    const token = normalizeAddress('token', params.token);
    const chain = await this.chain(network);
    const rpc = await this.rpc(network);

    const result = await rpc.callRaw({
      to: chain.contractAddress as string,
      data: encodeCall(SELECTOR_GET_MAX_SELLABLE_ETH, [addressWord(token)]),
    });
    if (!result.ok) throw revertError(result.revert, `getMaxSellableETH(${token})`);
    return decodeUint256At(result.data, 0).toString();
  }

  /** ERC-20 `allowance(owner, contract)` in wei — how much the curve may pull. */
  async allowance(params: TokenRef & { owner: string }): Promise<string> {
    const network = params.network ?? DEFAULT_NETWORK;
    const token = normalizeAddress('token', params.token);
    const owner = normalizeAddress('owner', params.owner);
    const chain = await this.chain(network);
    const rpc = await this.rpc(network);

    const data = await rpc.call({
      to: token,
      data: encodeCall(SELECTOR_ALLOWANCE, [
        addressWord(owner),
        addressWord(chain.contractAddress as string),
      ]),
    });
    return decodeUint256At(data, 0).toString();
  }

  /** ERC-20 `balanceOf(owner)` in the token's smallest unit. */
  async balanceOf(params: TokenRef & { owner: string }): Promise<string> {
    const network = params.network ?? DEFAULT_NETWORK;
    const token = normalizeAddress('token', params.token);
    const owner = normalizeAddress('owner', params.owner);
    const rpc = await this.rpc(network);

    const data = await rpc.call({
      to: token,
      data: encodeCall(SELECTOR_BALANCE_OF, [addressWord(owner)]),
    });
    return decodeUint256At(data, 0).toString();
  }

  // ----------------------------------------------------------------- Quotes

  /**
   * Price a buy: tokens out for a given amount of native currency in.
   *
   * @throws {@link FyuzTokenGraduatedError} when the curve is closed.
   */
  async quoteBuy(params: TokenRef & { amountWei: string }): Promise<BuyQuote> {
    const network = params.network ?? DEFAULT_NETWORK;
    const token = normalizeAddress('token', params.token);
    const amountIn = parseWeiAmount('amountWei', params.amountWei);
    if (amountIn === 0n) throw new FyuzInvalidArgumentError('amountWei must be greater than zero');

    const [amountOut, priceImpactBps] = await this.swapOutput(network, token, amountIn, true);
    const fee = BigInt(await this.firstBuyFee({ token, network }));

    return {
      network,
      token,
      amountInWei: amountIn.toString(),
      firstBuyFeeWei: fee.toString(),
      valueWei: (amountIn + fee).toString(),
      amountOutWei: amountOut.toString(),
      priceImpactBps,
    };
  }

  /**
   * Price a sell: native currency out for a given amount of tokens in.
   *
   * The figure is net of the platform and token-owner fees, which the contract
   * takes off the output rather than the input.
   *
   * @throws {@link FyuzTokenGraduatedError} when the curve is closed.
   */
  async quoteSell(params: TokenRef & { amountWei: string }): Promise<SellQuote> {
    const network = params.network ?? DEFAULT_NETWORK;
    const token = normalizeAddress('token', params.token);
    const amountIn = parseWeiAmount('amountWei', params.amountWei);
    if (amountIn === 0n) throw new FyuzInvalidArgumentError('amountWei must be greater than zero');

    const [amountOut, priceImpactBps] = await this.swapOutput(network, token, amountIn, false);
    return {
      network,
      token,
      amountInWei: amountIn.toString(),
      amountOutWei: amountOut.toString(),
      priceImpactBps,
    };
  }

  /** `getSwapOutput`, with the graduated revert promoted to a typed error. */
  private async swapOutput(
    network: string,
    token: string,
    amountIn: bigint,
    isEthInput: boolean,
  ): Promise<[bigint, number]> {
    const chain = await this.chain(network);
    const rpc = await this.rpc(network);

    const result = await rpc.callRaw({
      to: chain.contractAddress as string,
      data: encodeCall(SELECTOR_GET_SWAP_OUTPUT, [
        addressWord(token),
        uint256Word(amountIn),
        boolWord(isEthInput),
      ]),
    });

    if (!result.ok) {
      if (revertSelector(result.revert) === SELECTOR_ALREADY_LAUNCHED) {
        throw new FyuzTokenGraduatedError({ tokenAddress: token, data: result.revert });
      }
      throw revertError(result.revert, `getSwapOutput(${token})`);
    }

    return [decodeUint256At(result.data, 0), Number(decodeUint256At(result.data, 1))];
  }

  // ----------------------------------------------------------------- Builds

  /**
   * Spend an exact amount of native currency on a token.
   *
   * `transaction.value` already includes the first-buy fee; sending only
   * `amountWei` reverts with `InsufficientEthValue`. Any excess is refunded by
   * the contract.
   */
  async buildBuy(params: BuyOptions): Promise<BuiltTrade<BuyQuote>> {
    const network = params.network ?? DEFAULT_NETWORK;
    const quote = await this.quoteBuy({
      token: params.token,
      network,
      amountWei: params.amountWei,
    });
    const chain = await this.chain(network);

    const minAmountOut = applyLimit(params, BigInt(quote.amountOutWei), 'down', 'minAmountOut');
    const deadline = resolveDeadline(params);

    return {
      transaction: {
        chainId: chain.chainId,
        to: chain.contractAddress as string,
        data: encodeCall(SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS, [
          addressWord(quote.token),
          uint256Word(BigInt(quote.amountInWei)),
          uint256Word(minAmountOut),
          uint256Word(BigInt(deadline)),
        ]),
        value: `0x${BigInt(quote.valueWei).toString(16)}`,
        ...(params.from === undefined ? {} : { from: normalizeAddress('from', params.from) }),
      },
      quote,
      limitWei: minAmountOut.toString(),
      deadline,
    };
  }

  /**
   * Buy an exact number of tokens, capping what you spend.
   *
   * Slippage runs the other way here: `limitWei` is a `maxAmountIn`, so
   * `slippageBps` widens the cap rather than lowering a floor.
   */
  async buildBuyExactTokens(params: BuyExactTokensOptions): Promise<BuiltTrade<BuyQuote>> {
    const network = params.network ?? DEFAULT_NETWORK;
    const token = normalizeAddress('token', params.token);
    const wanted = parseWeiAmount('amountOutWei', params.amountOutWei);
    if (wanted === 0n) throw new FyuzInvalidArgumentError('amountOutWei must be greater than zero');

    // Price the reverse direction to learn roughly what the tokens cost, then
    // let the caller's tolerance set the ceiling on top of that estimate.
    const [nativeEstimate] = await this.swapOutput(network, token, wanted, false);
    if (nativeEstimate === 0n) {
      throw new FyuzInvalidArgumentError(
        `the curve prices ${params.amountOutWei} of ${token} at zero — ask for more tokens`,
      );
    }

    const maxAmountIn = applyLimit(params, nativeEstimate, 'up', 'maxAmountIn');
    const fee = BigInt(await this.firstBuyFee({ token, network }));
    const chain = await this.chain(network);
    const deadline = resolveDeadline(params);

    return {
      transaction: {
        chainId: chain.chainId,
        to: chain.contractAddress as string,
        data: encodeCall(SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS, [
          addressWord(token),
          uint256Word(wanted),
          uint256Word(maxAmountIn),
          uint256Word(BigInt(deadline)),
        ]),
        value: `0x${(maxAmountIn + fee).toString(16)}`,
        ...(params.from === undefined ? {} : { from: normalizeAddress('from', params.from) }),
      },
      quote: {
        network,
        token,
        amountInWei: nativeEstimate.toString(),
        firstBuyFeeWei: fee.toString(),
        valueWei: (maxAmountIn + fee).toString(),
        amountOutWei: wanted.toString(),
        priceImpactBps: 0,
      },
      limitWei: maxAmountIn.toString(),
      deadline,
    };
  }

  /**
   * Sell tokens for native currency.
   *
   * The contract pulls the tokens with `transferFrom`, so an ERC-20 approval
   * must already be in place — check {@link TradeClient.allowance} and send
   * {@link TradeClient.buildApprove} first, or the swap reverts inside the token.
   */
  async buildSell(params: SellOptions): Promise<BuiltTrade<SellQuote>> {
    const network = params.network ?? DEFAULT_NETWORK;
    const quote = await this.quoteSell({
      token: params.token,
      network,
      amountWei: params.amountWei,
    });
    const chain = await this.chain(network);

    const minAmountOut = applyLimit(params, BigInt(quote.amountOutWei), 'down', 'minAmountOut');
    const deadline = resolveDeadline(params);

    return {
      transaction: {
        chainId: chain.chainId,
        to: chain.contractAddress as string,
        data: encodeCall(SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH, [
          addressWord(quote.token),
          uint256Word(BigInt(quote.amountInWei)),
          uint256Word(minAmountOut),
          uint256Word(BigInt(deadline)),
        ]),
        value: '0x0',
        ...(params.from === undefined ? {} : { from: normalizeAddress('from', params.from) }),
      },
      quote,
      limitWei: minAmountOut.toString(),
      deadline,
    };
  }

  /**
   * ERC-20 `approve`, letting the curve pull tokens for a sell.
   *
   * Approves exactly `amountWei` by default. Pass `unlimited: true` for the
   * `uint256` max if you would rather approve once — it saves a transaction per
   * sell, at the cost of a standing allowance against an upgradeable contract.
   */
  async buildApprove(
    params: TokenRef & { amountWei?: string; unlimited?: boolean; from?: string },
  ): Promise<UnsignedTransaction> {
    const network = params.network ?? DEFAULT_NETWORK;
    const token = normalizeAddress('token', params.token);
    const chain = await this.chain(network);

    if (params.unlimited === true && params.amountWei !== undefined) {
      throw new FyuzInvalidArgumentError('pass either amountWei or unlimited, not both');
    }
    if (params.unlimited !== true && params.amountWei === undefined) {
      throw new FyuzInvalidArgumentError(
        'buildApprove needs amountWei, or unlimited: true to approve the uint256 maximum',
      );
    }

    const amount =
      params.unlimited === true ? UINT256_MAX : parseWeiAmount('amountWei', params.amountWei ?? '0');

    return {
      chainId: chain.chainId,
      to: token,
      data: encodeCall(SELECTOR_APPROVE, [
        addressWord(chain.contractAddress as string),
        uint256Word(amount),
      ]),
      value: '0x0',
      ...(params.from === undefined ? {} : { from: normalizeAddress('from', params.from) }),
    };
  }
}

/**
 * Turn a quote plus a tolerance into the limit that goes on-chain.
 *
 * `direction` is which way the tolerance moves the number: `'down'` for a
 * `minAmountOut` floor, `'up'` for a `maxAmountIn` ceiling.
 */
function applyLimit(
  options: SlippageOptions,
  quoted: bigint,
  direction: 'down' | 'up',
  fieldName: string,
): bigint {
  if (options.limitWei !== undefined && options.slippageBps !== undefined) {
    throw new FyuzInvalidArgumentError('pass either slippageBps or limitWei, not both');
  }

  if (options.limitWei !== undefined) {
    return parseWeiAmount('limitWei', options.limitWei);
  }

  if (options.slippageBps === undefined) {
    throw new FyuzInvalidArgumentError(
      `slippage protection is required: pass slippageBps (100 = 1%) or an explicit limitWei ` +
        `to set ${fieldName} yourself. There is no default, because the right tolerance ` +
        'depends on the trade and getting it wrong costs you money.',
    );
  }

  const bps = options.slippageBps;
  if (!Number.isInteger(bps) || bps < 0 || bps >= 10_000) {
    throw new FyuzInvalidArgumentError(
      `slippageBps must be a whole number in [0, 10000), got ${bps}`,
    );
  }

  const tolerance = BigInt(bps);
  return direction === 'down'
    ? (quoted * (BPS_DIVISOR - tolerance)) / BPS_DIVISOR
    : (quoted * (BPS_DIVISOR + tolerance)) / BPS_DIVISOR;
}

/** Absolute deadline in unix seconds, from whichever form the caller used. */
function resolveDeadline(options: SlippageOptions): number {
  if (options.deadline !== undefined) {
    if (!Number.isInteger(options.deadline) || options.deadline <= 0) {
      throw new FyuzInvalidArgumentError('deadline must be a positive unix timestamp in seconds');
    }
    return options.deadline;
  }
  const seconds = options.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new FyuzInvalidArgumentError('deadlineSeconds must be a positive whole number');
  }
  return Math.floor(Date.now() / 1000) + seconds;
}
