import axios from "axios";
import useSWR from "swr";
import { API_ENDPOINT } from "@/config";
import { useState } from "react";
import { CaipNetwork, type Provider as EVMProvider, useAppKitAccount, useAppKitNetworkCore, useAppKitProvider } from "@reown/appkit/react";
import type { Provider as SOLProvider } from "@reown/appkit-adapter-solana/react";
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

    const { data: tokenInfo, mutate } = useSWR(
        tokenAddress && network ? ['/info/token', tokenAddress, network, chains, address, pageNumber, pageSize, evmProvider, solProvider, connection] : undefined,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/tokens/${network}/${tokenAddress}`, {
                params: {
                    pageNumber, pageSize
                }
            })
            const tokenChain = chains?.find(chain => chain.network === network)
            const networks = ChainController.getCaipNetworks()
            const tokenNetwork = networks.find(network => network.id === tokenChain?.chainId || network.chainNamespace === tokenChain?.chainId)
            if (tokenChain && tokenNetwork) {
                if (tokenNetwork.chainNamespace === "eip155") {
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
            const { data: { trades } } = await axios.get(API_ENDPOINT, {
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
    if (network.chainNamespace === "eip155") {
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
    if (!connection)
        return undefined
    const client = new DynamicBondingCurveClient(connection, 'confirmed')
    return {
        getMint: (prefix?: string, sufix?: string) => {
            const mint = Keypair.generate()
            return mint
        },
        createToken: async(token: { name: string, symbol: string, pool: number, amount?: string, secretKey?: Uint8Array }) => {
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
            } catch(ex) {
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