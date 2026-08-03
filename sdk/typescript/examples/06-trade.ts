/**
 * Quote and build bonding-curve trades.
 *
 *   pnpm build:examples && node build/examples/06-trade.js [token] [wallet]
 *
 * **This example signs nothing and sends nothing.** It prints the unsigned
 * transactions, which is the whole surface `@fyuz/sdk` offers: you hand
 * `{ to, data, value }` to viem, ethers, a hardware signer or a multisig, and
 * that library owns the key. Nothing here can move funds.
 */

import {
  FyuzClient,
  FyuzTokenGraduatedError,
  formatUnits,
  parseUnits,
  type UnsignedTransaction,
} from '../src/index.js';

const [tokenArg, walletArg] = process.argv.slice(2);

// The endpoint /config publishes belongs to the API operator and is shared by
// every caller. Point this at your own node for anything real.
const client = new FyuzClient({
  trade: { rpcUrl: process.env['BSC_RPC_URL'] ?? 'https://bsc-dataseed.bnbchain.org' },
});

const chain = await client.trade.chain('bsc');
console.log(`chain      ${chain.name} (${chain.chainId})`);
console.log(`contract   ${chain.contractAddress}`);
console.log();

let token = tokenArg;
if (token === undefined) {
  const king = await client.getKing();
  if (king === null) {
    console.error('no king right now — pass a token address explicitly');
    process.exit(1);
  }
  token = king.tokenAddress;
  console.log(`using the king: ${king.tokenSymbol} (${token})\n`);
}

// ---------------------------------------------------------------- buying

const spend = parseUnits('0.01'); // 0.01 BNB, in wei

try {
  const quote = await client.trade.quoteBuy({ token, amountWei: spend });

  console.log('buy quote');
  console.log(`  spending       ${formatUnits(quote.amountInWei)} ${chain.currency}`);
  console.log(`  first-buy fee  ${formatUnits(quote.firstBuyFeeWei)} ${chain.currency}`);
  console.log(`  msg.value      ${formatUnits(quote.valueWei)} ${chain.currency}  ← includes the fee`);
  console.log(`  tokens out     ${formatUnits(quote.amountOutWei)}`);
  console.log(`  price impact   ${(quote.priceImpactBps / 100).toFixed(2)}%`);
  console.log();

  // slippageBps is required. There is no default, because the right tolerance
  // depends on the trade and a wrong one costs you money.
  const built = await client.trade.buildBuy({
    token,
    amountWei: spend,
    slippageBps: 100, // 1%
    deadlineSeconds: 120,
    ...(walletArg === undefined ? {} : { from: walletArg }),
  });

  console.log('buy transaction (unsigned)');
  printTransaction(built.transaction);
  console.log(`  minAmountOut   ${formatUnits(built.limitWei)} tokens`);
  console.log(`  deadline       ${new Date(built.deadline * 1000).toISOString()}`);
  console.log();
} catch (error) {
  if (error instanceof FyuzTokenGraduatedError) {
    // The SDK refuses rather than letting you pay gas to learn this on-chain.
    console.log(`buy refused: ${error.message}`);
    process.exit(0);
  }
  throw error;
}

// --------------------------------------------------------------- selling

const sellAmount = parseUnits('1000');
const sellQuote = await client.trade.quoteSell({ token, amountWei: sellAmount });

console.log('sell quote');
console.log(`  selling        ${formatUnits(sellQuote.amountInWei)} tokens`);
console.log(`  ${chain.currency} out         ${formatUnits(sellQuote.amountOutWei)}  ← net of fees`);
console.log(`  price impact   ${(sellQuote.priceImpactBps / 100).toFixed(2)}%`);
console.log();

// Selling needs an ERC-20 approval first: the contract pulls the tokens with
// transferFrom, so without one the swap reverts inside the token.
if (walletArg !== undefined) {
  const allowance = await client.trade.allowance({ token, owner: walletArg });
  console.log(`current allowance ${formatUnits(allowance)} tokens`);

  if (BigInt(allowance) < BigInt(sellAmount)) {
    console.log('\napprove transaction (unsigned) — send this before the sell');
    printTransaction(
      await client.trade.buildApprove({ token, amountWei: sellAmount, from: walletArg }),
    );
    console.log();
  }
}

const sell = await client.trade.buildSell({
  token,
  amountWei: sellAmount,
  slippageBps: 150, // 1.5%
  ...(walletArg === undefined ? {} : { from: walletArg }),
});

console.log('sell transaction (unsigned)');
printTransaction(sell.transaction);
console.log(`  minAmountOut   ${formatUnits(sell.limitWei)} ${chain.currency}`);
console.log();
console.log('Nothing above was signed or broadcast. Hand these to your wallet to execute.');

function printTransaction(transaction: UnsignedTransaction): void {
  console.log(`  chainId        ${transaction.chainId}`);
  console.log(`  to             ${transaction.to}`);
  console.log(`  value          ${transaction.value}`);
  console.log(`  data           ${transaction.data.slice(0, 74)}…`);
}
