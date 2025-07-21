import axios from "axios";
import useSWR from "swr";
import { API_ENDPOINT } from "@/config";
import { useState } from "react";
import { CaipNetwork, type Provider as EVMProvider, useAppKitAccount, useAppKitNetworkCore, useAppKitProvider } from "@reown/appkit/react";
import type { Connection, Provider as SOLProvider } from "@reown/appkit-adapter-solana/react";
import { useMainContext } from "@/context";
import { BrowserProvider, Contract, ethers, JsonRpcSigner, MaxUint256 } from "ethers";
import { useAppKitConnection } from "@reown/appkit-adapter-solana/react";
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import BN from 'bn.js'
import { erc20Abi } from "viem";
import { ChainController } from "@reown/appkit-controllers"

export function useTokenInfo(tokenAddress: string, network: string, pageNumber: number, pageSize: number) {
    const { chains } = useMainContext()
    const { address } = useAppKitAccount()
    const { chainId } = useAppKitNetworkCore()
    const { connection } = useAppKitConnection()
    const { walletProvider: evmProvider } = useAppKitProvider<EVMProvider>("eip155")
    const { walletProvider: solProvider } = useAppKitProvider<SOLProvider>("solana")
    // Determine if this is a Solana token
    const isSolanaToken = network === 'solana';

    const { data: tokenInfo, mutate } = useSWR(
        tokenAddress && network ? ['/info/token', tokenAddress, network, chains, address, pageNumber, pageSize, evmProvider, solProvider, connection] : undefined,
        async () => {

            if (isSolanaToken) {
                // Use Jupiter API for Solana tokens
                return await fetchSolanaTokenInfo(connection!, address!, tokenAddress, pageNumber, pageSize);
            }

            const { data } = await axios.get(`${API_ENDPOINT}/tokens/${network}/${tokenAddress}`, {
                params: {
                    pageNumber, pageSize
                }
            })
            try {
                const tokenChain = chains?.find(chain => chain.network === network)
                const networks = ChainController.getCaipNetworks()
                const tokenNetwork = networks.find(network => network.id === tokenChain?.chainId || network.chainNamespace === tokenChain?.chainId)
                if (tokenChain && tokenNetwork) {
                    if (tokenNetwork.chainNamespace === "eip155" && evmProvider) {
                        const provider = new BrowserProvider(evmProvider, chainId)
                        const tokenContract = new Contract(tokenAddress, erc20Abi, provider)
                        const contract = new Contract(tokenChain.contractAddress, tokenChain.abi, provider)
                        data.curveBalance = await tokenContract.balanceOf(tokenChain.contractAddress).catch(() => 0n)
                        if (address) {
                            data.balance = await tokenContract.balanceOf(address).catch(() => 0n)
                            data.allowance = await tokenContract.allowance(address, tokenChain.contractAddress).catch(() => 0n)
                        }
                        data.poolInfo = await contract.tokenPools(tokenAddress).catch(() => undefined)
                    } else if (tokenNetwork.chainNamespace === "solana" && connection) {
                        const client = new DynamicBondingCurveClient(connection, 'confirmed')
                        const mint = new PublicKey(tokenAddress)
                        const curveAccount = await connection.getTokenAccountsByOwner(new PublicKey(tokenChain.contractAddress), { mint })
                        data.curveBalance = await connection.getTokenAccountBalance(curveAccount?.value?.[0]?.pubkey)
                        if (address) {
                            const owner = new PublicKey(address)
                            const account = await connection.getTokenAccountsByOwner(owner, { mint })
                            data.balance = await connection.getTokenAccountBalance(account?.value?.[0]?.pubkey)
                            data.allowance = MaxUint256
                        }
                        data.poolInfo = await client.state.getPoolConfig(tokenChain.contractAddress)
                    }
                }
            } catch (ex) {
                console.log(ex)
            }
            return data
        }, {
        refreshInterval: 5000,
        keepPreviousData: true,
    }
    )
    return {
        tokenInfo, reload: mutate
    }
}

export function useTokens(filter: any) {
    const { data, mutate } = useSWR(
        ['/list/tokens', filter],
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/tokens`, {
                params: filter,
            })
            return data
        }, {
        refreshInterval: 5000,
        keepPreviousData: true
    }
    )
    return {
        tokens: data?.tokenList ?? [],
        count: data?.tokenCount ?? 0,
        reload: mutate
    }
}

export function useNewTrades() {
    const [latestTradeId, setLatestTradeId] = useState<string>()

    const { data, mutate } = useSWR(
        '/list/trades',
        async () => {
            const { data: { trades } } = await axios.get(`${API_ENDPOINT}/trades/recent`, {
                params: {
                    latestTradeId,
                }
            })
            if (trades.length) {
                setLatestTradeId(trades[0].id)
            }
            return trades.reverse()
        }, {
        refreshInterval: 5000,
    }
    )
    return {
        trades: data,
        reload: mutate
    }
}

export function useHandlers(network?: CaipNetwork) {
    const { chains } = useMainContext()
    const { address } = useAppKitAccount()
    // const { chainId, caipNetwork } = useAppKitNetworkCore()
    const { connection } = useAppKitConnection()
    const { walletProvider: evmProvider } = useAppKitProvider<EVMProvider>("eip155")
    const { walletProvider: solProvider } = useAppKitProvider<SOLProvider>("solana")
    if (!network || !chains)
        return undefined
    const chain = chains.find(c => c.chainId === network.id || c.chainId === network.chainNamespace)
    if (!chain)
        return undefined
    if (network.chainNamespace === "eip155" && evmProvider) {
        const provider = new BrowserProvider(evmProvider, network.id)
        return {
            createToken: async (token: { name: string, symbol: string, pool: number, amount?: string }, sig: any) => {
                if (!address)
                    throw Error("Connect wallet")
                const signer = new JsonRpcSigner(provider, address as string)
                const initBuyAmount = Number(token.amount ?? '0')
                const contract = new Contract(chain.contractAddress, chain.abi, signer)
                const createFeeAmount = await contract.CREATE_TOKEN_FEE_AMOUNT();
                const firstBuyFee = initBuyAmount > 0 ? await contract.getFirstBuyFee(ethers.ZeroAddress) : 0n
                const balance = await signer.provider.getBalance(signer.address)
                const value = ethers.parseEther(token.amount ?? '0') + createFeeAmount + firstBuyFee
                if (balance < value)
                    throw Error("Insufficient balance")
                const tx = await contract.createToken(
                    token.name, token.symbol, ethers.parseEther(token.amount ?? '0'), sig, token.pool, { value }
                )
                return tx
            },
            approve: async (token: string) => {
                if (!address)
                    throw Error("Connect wallet")
                const signer = new JsonRpcSigner(provider, address as string)
                const contract = new Contract(token, erc20Abi, signer)
                return await contract.approve(chain.contractAddress, MaxUint256)
            },
            buyToken: async (token: string, amount: string, slippage: bigint, exactInput?: boolean) => {
                if (!address)
                    throw Error("Connect wallet")
                const signer = new JsonRpcSigner(provider, address as string)
                const contract = new Contract(chain.contractAddress, chain.abi, signer)
                const firstBuyFee = await contract.getFirstBuyFee(token)
                const poolInfo = await contract.tokenPools(token).catch(() => undefined)
                if (!poolInfo)
                    throw Error("Invalid token")
                if (exactInput) {
                    const amountInput = ethers.parseEther(amount ?? '0')
                    const amountInWithFee = amountInput * 97n / 100n
                    const estimateAmount = amountInWithFee * poolInfo.virtualTokenReserve / (poolInfo.virtualEthReserve + amountInWithFee)
                    const amountOutMin = estimateAmount * (10000n - slippage) / 10000n
                    const gas = await contract.swapExactETHForTokens.estimateGas(token, amountInput, amountOutMin, { value: amountInput + firstBuyFee })
                    return await contract.swapExactETHForTokens(token, amountInput, amountOutMin, { value: amountInput + firstBuyFee, gas })
                }
                const amountOut = ethers.parseEther(amount ?? '0')
                const amountInWei = amountOut * poolInfo.virtualEthReserve / (poolInfo.virtualTokenReserve - amountOut) + 1n
                const estimateAmount = amountInWei * 100n / 97n
                const amountInMax = estimateAmount * (10000n + slippage) / 10000n
                return await contract.swapETHForExactTokens(token, amountOut, amountInMax, { value: amountInMax + firstBuyFee })
            },
            sellToken: async (token: string, amount: string, slippage: bigint) => {
                if (!address)
                    throw Error("Connect wallet")
                const signer = new JsonRpcSigner(provider, address as string)
                const contract = new Contract(chain.contractAddress, chain.abi, signer)
                const poolInfo = await contract.tokenPools(token).catch(() => undefined)
                if (!poolInfo)
                    throw Error("Invalid token")
                const amountInput = ethers.parseEther(amount ?? '0')
                const estimateAmount = amountInput * poolInfo.virtualEthReserve / (poolInfo.virtualTokenReserve + amountInput) * 97n / 100n
                const amountOutMin = estimateAmount * (10000n - slippage) / 10000n
                const gas = await contract.swapExactTokensForETH.estimateGas(token, amountInput, amountOutMin)
                return await contract.swapExactTokensForETH(token, amountInput, amountOutMin, { gas })
            },
            quoteBuy: async (token: string, amount: string, exactInput?: boolean) => {
                const contract = new Contract(chain.contractAddress, chain.abi, provider)
                const poolInfo = await contract.tokenPools(token).catch(() => undefined)
                if (!poolInfo)
                    throw Error("Invalid token")
                const tokenContract = new Contract(token, erc20Abi, provider)
                const balance = address ? await provider.getBalance(address) : 0n
                if (exactInput) {
                    const amountInput = ethers.parseEther(amount ?? '0')
                    const amountInWithFee = amountInput * 97n / 100n
                    if (balance < amountInWithFee)
                        throw Error(`Insufficient ${network.nativeCurrency.symbol} balance`)
                    const estimateAmount = amountInWithFee * poolInfo.virtualTokenReserve / (poolInfo.virtualEthReserve + amountInWithFee)
                    return ethers.formatEther(estimateAmount)
                }
                const amountOut = ethers.parseEther(amount ?? '0')
                const amountInWei = amountOut * poolInfo.virtualEthReserve / (poolInfo.virtualTokenReserve - amountOut) + 1n
                const estimateAmount = amountInWei * 100n / 97n
                if (balance < estimateAmount)
                    throw Error(`Insufficient ${network.nativeCurrency.symbol} balance`)
                return ethers.formatEther(estimateAmount)
            },
            quoteSell: async (token: string, amount: string) => {
                const contract = new Contract(chain.contractAddress, chain.abi, provider)
                const poolInfo = await contract.tokenPools(token).catch(() => undefined)
                if (!poolInfo)
                    throw Error("Invalid token")
                const amountInput = ethers.parseEther(amount ?? '0')
                const estimateAmount = amountInput * poolInfo.virtualEthReserve / (poolInfo.virtualTokenReserve + amountInput) * 97n / 100n
                return ethers.formatEther(estimateAmount)
            }
        }
    }
    if (!connection || !solProvider)
        return undefined
    const client = new DynamicBondingCurveClient(connection, 'confirmed')
    return {
        getMint: (prefix?: string, sufix?: string) => {
            const mint = Keypair.generate()
            return mint
        },
        createToken: async (token: { name: string, symbol: string, pool: number, amount?: string, secretKey?: Uint8Array }) => {
            try {
                if (!address || !token.secretKey)
                    return
                const mint = Keypair.fromSecretKey(token.secretKey)
                const payer = new PublicKey(address)
                const value = ethers.parseUnits(token.amount ?? '0', 9)
                const { createPoolTx, swapBuyTx } = await client.pool.createPoolWithFirstBuy({
                    createPoolParam: {
                        config: new PublicKey(chain.contractAddress),
                        baseMint: mint.publicKey,
                        name: token.name,
                        symbol: token.symbol,
                        uri: `${API_ENDPOINT}/token/${mint.publicKey}`,
                        payer,
                        poolCreator: payer,
                    },
                    firstBuyParam: {
                        buyer: payer,
                        minimumAmountOut: new BN(0),
                        buyAmount: new BN(value),
                        referralTokenAccount: null
                    }
                })
                // console.log(createPoolTx.instructions)
                const { blockhash } = await connection.getLatestBlockhash()
                const tx = new VersionedTransaction(
                    new TransactionMessage({
                        payerKey: payer,
                        recentBlockhash: blockhash,
                        instructions: [
                            ...createPoolTx.instructions,
                            ...(swapBuyTx?.instructions ?? []),
                        ]
                    }).compileToV0Message()
                )
                tx.sign([mint])
                return await solProvider.sendTransaction(tx, connection)
            } catch (ex) {
                throw ex
            }
        },
        buyToken: async (token: string, amount: string, slippage: bigint, exactInput?: boolean) => {
            if (!address)
                return
            const payer = new PublicKey(address)
            const poolAccount = await client.state.getPoolByBaseMint(token)
            if (!poolAccount)
                throw Error("Invalid token")
            let amountIn = new BN(Math.floor(Number(amount) * LAMPORTS_PER_SOL))
            let minimumAmountOut = new BN(0)
            const virtualPool = poolAccount.account
            const poolConfigData = await client.state.getPoolConfig(chain.contractAddress)
            if (exactInput) {
                const quote = await client.pool.swapQuote({
                    virtualPool: virtualPool,
                    config: poolConfigData,
                    swapBaseForQuote: false,
                    amountIn,
                    // slippageBps: 200,
                    hasReferral: false,
                    currentPoint: new BN(0)
                })
                minimumAmountOut = quote.amountOut.mul(new BN(10000n - slippage)).div(new BN(10000))
            } else {
                const quote = await client.pool.swapQuoteExactOut({
                    virtualPool: virtualPool,
                    config: poolConfigData,
                    swapBaseForQuote: false,
                    outAmount: new BN(Math.floor(Number(amount) * 1000000)),
                    // slippageBps: 200,
                    hasReferral: false,
                    currentPoint: new BN(0)
                })
                amountIn = quote.amountOut.mul(new BN(10000n + slippage)).div(new BN(10000))
                minimumAmountOut = new BN(Math.floor(Number(amount) * 1000000))
            }
            const buyTx = await client.pool.swap({
                payer,
                owner: payer,
                amountIn,
                minimumAmountOut,
                swapBaseForQuote: false,
                pool: poolAccount.publicKey,
                referralTokenAccount: null,
            })
            const { blockhash } = await connection.getLatestBlockhash()
            const tx = new VersionedTransaction(
                new TransactionMessage({
                    payerKey: payer,
                    recentBlockhash: blockhash,
                    instructions: buyTx.instructions
                }).compileToV0Message()
            )
            return await solProvider.sendTransaction(tx, connection)
        },
        sellToken: async (token: string, amount: string, slippage: bigint) => {
            if (!address)
                return
            const payer = new PublicKey(address)
            const poolAccount = await client.state.getPoolByBaseMint(token)
            if (!poolAccount)
                throw Error("Invalid token")
            let amountIn = new BN(Math.floor(Number(amount) * LAMPORTS_PER_SOL))
            const poolConfigData = await client.state.getPoolConfig(chain.contractAddress)
            const virtualPool = poolAccount.account
            const quote = await client.pool.swapQuote({
                virtualPool: virtualPool,
                config: poolConfigData,
                swapBaseForQuote: true,
                amountIn: new BN(Math.floor(Number(amount) * 1000000)),
                // slippageBps: 200,
                hasReferral: false,
                currentPoint: new BN(0)
            })
            const minimumAmountOut = quote.amountOut.mul(new BN(10000n - slippage)).div(new BN(10000))
            const sellTx = await client.pool.swap({
                payer,
                owner: payer,
                amountIn,
                minimumAmountOut,
                swapBaseForQuote: true,
                pool: poolAccount.publicKey,
                referralTokenAccount: null,
            })
            const { blockhash } = await connection.getLatestBlockhash()
            const tx = new VersionedTransaction(
                new TransactionMessage({
                    payerKey: payer,
                    recentBlockhash: blockhash,
                    instructions: sellTx.instructions
                }).compileToV0Message()
            )
            return await solProvider.sendTransaction(tx, connection)
        },
        quoteBuy: async (token: string, amount: string, exactInput?: boolean) => {
            const poolAccount = await client.state.getPoolByBaseMint(token)
            if (!poolAccount)
                throw Error("Invalid token")
            const poolConfigData = await client.state.getPoolConfig(chain.contractAddress)
            const virtualPool = poolAccount.account
            if (exactInput) {
                const quote = await client.pool.swapQuote({
                    virtualPool: virtualPool,
                    config: poolConfigData,
                    swapBaseForQuote: false,
                    amountIn: new BN(Math.floor(Number(amount) * LAMPORTS_PER_SOL)),
                    // slippageBps: 200,
                    hasReferral: false,
                    currentPoint: new BN(0)
                })
                return (quote.amountOut.toNumber() / 1000000).toString()
            }
            const quote = await client.pool.swapQuoteExactOut({
                virtualPool: virtualPool,
                config: poolConfigData,
                swapBaseForQuote: false,
                outAmount: new BN(Math.floor(Number(amount) * 1000000)),
                // slippageBps: 200,
                hasReferral: false,
                currentPoint: new BN(0)
            })
            return (quote.amountOut.toNumber() / LAMPORTS_PER_SOL).toString()
        },
        quoteSell: async (token: string, amount: string) => {
            const poolAccount = await client.state.getPoolByBaseMint(token)
            if (!poolAccount)
                throw Error("Invalid token")
            const poolConfigData = await client.state.getPoolConfig(chain.contractAddress)
            const virtualPool = poolAccount.account
            const quote = await client.pool.swapQuote({
                virtualPool: virtualPool,
                config: poolConfigData,
                swapBaseForQuote: true,
                amountIn: new BN(Math.floor(Number(amount) * 1000000)),
                // slippageBps: 200,
                hasReferral: false,
                currentPoint: new BN(0)
            })
            return (quote.amountOut.toNumber() / LAMPORTS_PER_SOL).toString()
        },
    }
}


const JUPITER_BASE_URL = 'https://datapi.jup.ag';

// Jupiter API client
class JupiterClient {
    static async getToken(assetId: string) {
        const response = await axios.get(`${JUPITER_BASE_URL}/v1/pools?assetIds=${assetId}`,);
        return response.data;
    }

    static async getTokenHolders(assetId: string) {
        try {
            const response = await axios.get(`${JUPITER_BASE_URL}/v1/holders/${assetId}`);
            return response.data;
        } catch (error) {
            console.log('Error fetching holders:', error);
            return [];
        }
    }

    static async getTokenTxs(assetId: string, params: any) {
        try {
            const response = await axios.get(`${JUPITER_BASE_URL}/v1/txs/${assetId}`);
            return response.data;
        } catch (error) {
            console.log('Error fetching trades:', error);
            return { data: [], total: 0 };
        }
    }

    static async getChart(assetId: string, params: any) {
        try {
            const response = await axios.get(`${JUPITER_BASE_URL}/v2/charts/${assetId}`, {
                params: params
            });
            return response.data;
        } catch (error) {
            console.log('Error fetching chart data:', error);
            return [];
        }
    }
}

// Transform Jupiter data to match EVM structure
function transformJupiterTokenData(jupiterResponse: any) {
    if (!jupiterResponse.pools || jupiterResponse.pools.length === 0) {
        throw new Error('No token data found');
    }

    const pool = jupiterResponse.pools[0];
    const baseAsset = pool.baseAsset;

    // Calculate price changes from stats
    const stats1h = baseAsset.stats1h || {};
    const stats24h = baseAsset.stats24h || {};
    const stats6h = baseAsset.stats6h || {};

    // Estimate 15m change from 1h data (rough approximation)
    const priceChange1h = stats1h.priceChange || 0;
    const priceChange15m = priceChange1h ? (priceChange1h / 4).toFixed(2) : '0.00';
    const price15mValue = baseAsset.usdPrice * (1 + (parseFloat(priceChange15m) / 100));

    return {
        tokenAddress: baseAsset.id,
        tokenName: baseAsset.name,
        tokenSymbol: baseAsset.symbol,
        tokenImage: baseAsset.image || null,
        tokenDescription: baseAsset.description || null,
        creatorAddress: baseAsset.dev,
        network: 'solana',
        price: baseAsset.usdPrice,
        marketcap: baseAsset.mcap,
        fdv: baseAsset.fdv,
        liquidity: pool.liquidity,
        volume: pool.volume24h,
        totalSupply: baseAsset.totalSupply,
        circSupply: baseAsset.circSupply,
        holderCount: baseAsset.holderCount,
        createdAt: pool.createdAt,
        updatedAt: pool.updatedAt,
        creationTime: pool.createdAt,
        category: 0, // Default to normal
        organicScore: baseAsset.organicScore,
        organicScoreLabel: baseAsset.organicScoreLabel,
        tags: baseAsset.tags,
        audit: baseAsset.audit,
        stats1h: baseAsset.stats1h,
        stats6h: baseAsset.stats6h,
        stats24h: baseAsset.stats24h,
        // Calculate price changes
        price15m: price15mValue.toFixed(12),
        priceChange15m: priceChange15m,
        priceChange1h: stats1h.priceChange || 0,
        priceChange6h: stats6h.priceChange || 0,
        priceChange24h: stats24h.priceChange || 0,
        volumeChange24h: stats24h.volumeChange || 0,
        liquidityChange1h: stats1h.liquidityChange || 0,
        liquidityChange6h: stats6h.liquidityChange || 0,
        liquidityChange24h: stats24h.liquidityChange || 0,
        liquidity1d: stats24h.buyVolume || pool.liquidity,
        // Trading stats
        numBuys1h: stats1h.numBuys || 0,
        numBuys6h: stats6h.numBuys || 0,
        numBuys24h: stats24h.numBuys || 0,
        numTraders1h: stats1h.numTraders || 0,
        numTraders6h: stats6h.numTraders || 0,
        numTraders24h: stats24h.numTraders || 0,
        numNetBuyers1h: stats1h.numNetBuyers || 0,
        numNetBuyers6h: stats6h.numNetBuyers || 0,
        numNetBuyers24h: stats24h.numNetBuyers || 0,
        buyVolume1h: stats1h.buyVolume || 0,
        buyVolume6h: stats6h.buyVolume || 0,
        buyVolume24h: stats24h.buyVolume || 0,
        holderChange1h: stats1h.holderChange || 0,
        holderChange6h: stats6h.holderChange || 0,
        holderChange24h: stats24h.holderChange || 0,
        progress: 100, // Solana tokens are typically already launched
        launchedAt: pool.createdAt,
        poolType: 2, // Default pool type for Solana
        bondingCurve: pool.bondingCurve || 0,
        dex: pool.dex,
        chain: pool.chain,
        decimals: baseAsset.decimals || 6,
        // Pool specific data
        poolId: pool.id,
        // poolType: pool.type,
        quoteAsset: pool.quoteAsset,
        launchpad: baseAsset.launchpad,
        metaLaunchpad: baseAsset.metaLaunchpad,
        partnerConfig: baseAsset.partnerConfig,
        firstPool: baseAsset.firstPool,
        tokenProgram: baseAsset.tokenProgram,
        priceBlockId: baseAsset.priceBlockId
    };
}

function transformJupiterHoldersData(jupiterHoldersResponse: any) {
    if (!jupiterHoldersResponse.holders) {
        return [];
    }

    return jupiterHoldersResponse.holders.map((holder: any, index: number) => ({
        holderAddress: holder.address,
        tokenAmount: holder.amount,
        percentage: ((holder.amount / 1000000000) * 100), // Calculate percentage based on total supply
        rank: index + 1,
        user: null, // No user data from Jupiter
        solBalance: holder.solBalance,
        tags: holder.tags || []
    }));
}


function transformJupiterTradesData(jupiterTxsResponse: any) {
    if (!jupiterTxsResponse.txs) {
        return [];
    }

    return jupiterTxsResponse.txs.map((tx: any) => ({
        txHash: tx.txHash,
        swapperAddress: tx.traderAddress,
        type: tx.type.toUpperCase(), // 'BUY' or 'SELL'
        tokenAmount: tx.amount,
        ethAmount: tx.nativeVolume, // SOL amount instead of ETH
        tokenPrice: tx.usdPrice,
        usdVolume: tx.usdVolume,
        date: Math.floor(new Date(tx.timestamp).getTime() / 1000),
        createdAt: tx.timestamp,
        user: null, // No user data from Jupiter
        asset: tx.asset,
        poolId: tx.poolId,
        isMev: tx.isMev,
        isValidPrice: tx.isValidPrice,
        isMrp: tx.isMrp,
        nativeVolume: tx.nativeVolume,
        timestamp: tx.timestamp
    }));
}

// Solana token info fetcher
async function fetchSolanaTokenInfo(connection: Connection, address: string, tokenAddress: string, pageNumber: number, pageSize: number) {
    // Fetch token data
    const jupiterTokenResponse = await JupiterClient.getToken(tokenAddress);

    if (!jupiterTokenResponse || !jupiterTokenResponse.pools || jupiterTokenResponse.pools.length === 0) {
        throw new Error('Solana token not found');
    }

    const tokenDetils = transformJupiterTokenData(jupiterTokenResponse);

    // Fetch holders data
    const jupiterHoldersResponse = await JupiterClient.getTokenHolders(tokenAddress);
    const holdersDetails = transformJupiterHoldersData(jupiterHoldersResponse);

    // Fetch trades data
    const jupiterTxsResponse = await JupiterClient.getTokenTxs(tokenAddress, {
        limit: pageSize,
        offset: (pageNumber - 1) * pageSize
    });

    const trades = transformJupiterTradesData(jupiterTxsResponse);
    const tradesCount = jupiterTxsResponse.txs?.length || 0;

    // Create pool info for compatibility with existing UI
    const pool = jupiterTokenResponse.pools[0];
    const poolInfo = {
        launched: true,
        virtualEthReserve: BigInt(Math.floor(pool.liquidity * 1e18)), // Convert SOL liquidity to wei
        virtualTokenReserve: BigInt(Math.floor(pool.baseAsset.totalSupply * Math.pow(10, pool.baseAsset.decimals))),
        bondingCurve: pool.bondingCurve || 0,
        dex: pool.dex,
        type: pool.type
    };

    // Get token balance
    // const tokenAccounts = await connection.getTokenAccountsByOwner(new PublicKey(tokenAddress), {
    //     mint: new PublicKey(address)
    // });
    // console.log(tokenAccounts)

    return {
        tokenDetils,
        trades,
        tradesCount,
        holdersDetails,
        poolInfo,
        balance: 0n, // User balance - would need Solana wallet connection
        allowance: 0n, // Token allowance - not applicable for Solana
        curveBalance: BigInt(Math.floor((tokenDetils.totalSupply - tokenDetils.circSupply) * Math.pow(10, pool.baseAsset.decimals || 6))),
        tokenContract: null, // No contract for Solana tokens
        isSolana: true
    };
}