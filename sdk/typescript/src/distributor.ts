/**
 * The Distributor sub-client: the on-chain leaderboard fee distribution.
 *
 * Reached through {@link FyuzClient.distributor}, never constructed directly.
 *
 * @module
 */

import type { HttpClient, RequestOptions } from './http.js';
import { pathSegment } from './http.js';
import type {
  AddressPayouts,
  Claimable,
  PayoutStats,
  Pot,
  RoundDetail,
  RoundReceipt,
  Shares,
} from './models/distributor.js';
import type { ListRoundsParams, SharesParams } from './params.js';
import { requireInteger, requireString } from './validate.js';

/**
 * Read-only view of the Fyuz Distributor.
 *
 * A slice of every trade fee accumulates in the Distributor contract. At the end
 * of each round most of the pot is paid out pro-rata by leaderboard points and the
 * remainder goes to a single Chainlink-VRF-picked winner. These endpoints expose
 * the whole ledger: what is in the pot now, what each address is projected to get,
 * and every wei that has already been paid.
 *
 * **All `*Wei` values are exact decimal strings.** Use `BigInt()` on them; never
 * `Number()`.
 *
 * ```ts
 * const pot = await client.distributor.getPot();
 * if (pot.potBnb === null) {
 *   console.log('pot unknown right now'); // NOT zero
 * } else {
 *   console.log(`${pot.potBnb} BNB up for grabs, round closes at ${pot.roundEnd}`);
 * }
 * ```
 */
export class DistributorClient {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /**
   * Lifetime payback totals: wei paid, rounds settled, unique recipients.
   *
   * ```ts
   * const stats = await client.distributor.getStats();
   * const paid = BigInt(stats.totalPaidWei); // exact — never Number()
   * ```
   */
  async getStats(options?: RequestOptions): Promise<PayoutStats> {
    return this.http.request<PayoutStats>({ method: 'GET', path: '/distributor/stats', options });
  }

  /**
   * The live undistributed pot plus the parameters needed to price a point.
   *
   * `potBnb` and `totalPoints` are `null` when the chain read failed — treat that
   * as unknown, not zero.
   */
  async getPot(options?: RequestOptions): Promise<Pot> {
    return this.http.request<Pot>({ method: 'GET', path: '/distributor/pot', options });
  }

  /**
   * The share allocation the round-runner will post on-chain, plus the exact
   * `postShares` calldata in {@link Shares.packed}.
   *
   * @param params - Optional window and holder cap. `to` must be after `from`.
   */
  async getShares(params: SharesParams = {}, options?: RequestOptions): Promise<Shares> {
    return this.http.request<Shares>({
      method: 'GET',
      path: '/distributor/shares',
      query: { from: params.from, to: params.to, limit: params.limit },
      options,
    });
  }

  /**
   * The public payout ledger: settled rounds, newest first.
   *
   * ```ts
   * const rounds = await client.distributor.listRounds({ limit: 10 });
   * ```
   */
  async listRounds(params: ListRoundsParams = {}, options?: RequestOptions): Promise<RoundReceipt[]> {
    return this.http.request<RoundReceipt[]>({
      method: 'GET',
      path: '/distributor/rounds',
      query: { limit: params.limit, offset: params.offset },
      options,
    });
  }

  /**
   * One round with its full recipient list.
   *
   * The receipt fields are flattened onto the same object as `payouts` — read
   * `round.potWei`, not `round.round.potWei`.
   *
   * @param id - Round id.
   * @throws {@link FyuzNotFoundError} when no such round exists.
   */
  async getRound(id: number, options?: RequestOptions): Promise<RoundDetail> {
    requireInteger('id', id);
    return this.http.request<RoundDetail>({
      method: 'GET',
      path: `/distributor/rounds/${pathSegment(id)}`,
      options,
    });
  }

  /**
   * Every payout one wallet has received, newest round first.
   *
   * @param address - Wallet address; matched case-insensitively.
   */
  async getPayouts(address: string, options?: RequestOptions): Promise<AddressPayouts> {
    requireString('address', address);
    return this.http.request<AddressPayouts>({
      method: 'GET',
      path: `/distributor/payouts/${pathSegment(address)}`,
      options,
    });
  }

  /**
   * Wei owed to an address from payout pushes the contract could not complete.
   *
   * `claimableWei` is `null` when the RPC is unreachable — hide the claim banner
   * rather than telling the user nothing is owed. Claiming itself is an on-chain
   * call the wallet signs; this API only reads.
   */
  async getClaimable(address: string, options?: RequestOptions): Promise<Claimable> {
    requireString('address', address);
    return this.http.request<Claimable>({
      method: 'GET',
      path: `/distributor/claimable/${pathSegment(address)}`,
      options,
    });
  }
}
