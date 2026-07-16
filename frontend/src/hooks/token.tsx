import axios from "axios";
import useSWR from "swr";
import { API_ENDPOINT } from "@/config";
import { useEffect, useRef, useState } from "react";
import { socket } from "@/utils/socket";
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

const uniswapV2RouterAbi = [
    "function WETH() external view returns (address)",
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapETHForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
    "function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)",
]

const liquidityManagerAbi = [
    "function getRouterV2() external view returns (address)",
    "function WETH() external view returns (address)",
]

export function useTokenInfo(tokenAddress: string, network: string, pageNumber: number, pageSize: number) {
    const { chains } = useMainContext()
    const { address } = useAppKitAccount()
    const { chainId } = useAppKitNetworkCore()
    const { connection } = useAppKitConnection()
    const { walletProvider: evmProvider } = useAppKitProvider<EVMProvider>("eip155")
    const { walletProvider: solProvider } = useAppKitProvider<SOLProvider>("solana")
    // Determine if this is a Solana token
    const isSolanaToken = network === 'solana';

    // Use stable primitives in SWR key (avoid provider objects which change reference)
    const { data: tokenInfo, mutate, error, isLoading } = useSWR(
        tokenAddress && network ? ['/info/token', tokenAddress, network, address, pageNumber, pageSize, !!evmProvider, !!solProvider, !!connection] : undefined,
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
                const tokenNetwork = networks?.find(net => net && (net.id === tokenChain?.chainId || net.chainNamespace === tokenChain?.chainId))
                if (tokenChain && tokenNetwork) {
                    if (tokenNetwork.chainNamespace === "eip155") {
                        // Use chain's configured RPC for reads (not wallet provider which may differ)
                        const readProvider = new ethers.JsonRpcProvider(tokenChain.rpcUrl)
                        const tokenContract = new Contract(tokenAddress, erc20Abi, readProvider)
                        const contract = new Contract(tokenChain.contractAddress, tokenChain.abi, readProvider)
                        data.curveBalance = await tokenContract.balanceOf(tokenChain.contractAddress).catch(() => 0n)
                        data.poolInfo = await contract.tokenPools(tokenAddress).catch(() => undefined)
                        if (address) {
                            data.balance = await tokenContract.balanceOf(address).catch(() => 0n)
                            if (data.poolInfo?.launched) {
                                // Graduated token: check allowance against Uniswap V2 router
                                try {
                                    const lmAddress = await contract.liquidityManager()
                                    const lm = new Contract(lmAddress, liquidityManagerAbi, readProvider)
                                    const routerAddress = await lm.getRouterV2()
                                    data.allowance = await tokenContract.allowance(address, routerAddress).catch(() => 0n)
                                    data.routerAddress = routerAddress
                                } catch {
                                    data.allowance = 0n
                                }
                            } else {
                                data.allowance = await tokenContract.allowance(address, tokenChain.contractAddress).catch(() => 0n)
                            }
                        }
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
        refreshInterval: 3000,
        keepPreviousData: true,
    }
    )
    // Listen for real-time trade events via WebSocket
    useEffect(() => {
        if (!tokenAddress) return
        const handler = (data: string) => {
            const lines = data.split('\n')
            const hasMatch = lines.some(line => {
                const addr = line.split('~')[0]
                return addr?.toLowerCase() === tokenAddress.toLowerCase()
            })
            if (hasMatch) mutate()
        }
        socket.on('m', handler)
        return () => { socket.off('m', handler) }
    }, [tokenAddress, mutate])

    return {
        tokenInfo, reload: mutate, error, isLoading
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

    // Refresh token list on any trade or deploy event
    useEffect(() => {
        const onTrade = () => mutate()
        const onDeploy = () => mutate()
        socket.on('m', onTrade)
        socket.on('deployed', onDeploy)
        return () => {
            socket.off('m', onTrade)
            socket.off('deployed', onDeploy)
        }
    }, [mutate])

    return {
        tokens: data?.tokenList ?? [],
        count: data?.tokenCount ?? 0,
        reload: mutate
    }
}

export function useKing() {
    const { data, mutate } = useSWR(
        '/tokens/king',
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/tokens/king`)
            return data
        }, {
        refreshInterval: 10000,
        keepPreviousData: true
    })

    useEffect(() => {
        const onTrade = () => mutate()
        socket.on('m', onTrade)
        return () => { socket.off('m', onTrade) }
    }, [mutate])

    return { king: data?.king ?? null }
}

export function useNewTrades() {
    const [latestTradeId, setLatestTradeId] = useState<string>()
    // /trades/recent is a DELTA feed: with latestTradeId set it only returns
    // trades newer than that id, so any quiet poll yields []. Returning that
    // directly would blank consumers every 5s of market silence (the activity
    // ticker unmounted this way). Accumulate deltas into a capped rolling
    // buffer instead — "recent activity", not "activity since the last poll".
    const bufferRef = useRef<any[]>([])

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
                // Dedupe by id: a socket-triggered mutate can race the 5s
                // interval, and both fetches may carry the same delta.
                const seen = new Set(bufferRef.current.map((t: any) => t.id))
                const fresh = trades.slice().reverse().filter((t: any) => !seen.has(t.id))
                bufferRef.current = [...bufferRef.current, ...fresh].slice(-50)
            }
            return bufferRef.current
        }, {
        refreshInterval: 5000,
    }
    )

    // Refresh trades on any socket trade event
    useEffect(() => {
        const onTrade = () => mutate()
        socket.on('m', onTrade)
        return () => { socket.off('m', onTrade) }
    }, [mutate])

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

    // Match chain by chainId or network name, with special handling for localhost/hardhat
    const chain = chains.find(c => {
        // Direct chainId match
        if (c.chainId === network.id || c.chainId === network.chainNamespace) {
            return true
        }
        // Match localhost networks (both 1337 and 31337)
        const isLocalhostChain = c.network === 'localhost' || c.chainId === 31337 || c.chainId === 1337
        const isLocalhostNetwork = network.id === 31337 || network.id === 1337 || network.name?.toLowerCase().includes('localhost')
        if (isLocalhostChain && isLocalhostNetwork) {
            return true
        }
        return false
    })

    if (!chain) {
        return undefined
    }
    if (network.chainNamespace === "eip155" && evmProvider) {
        const provider = new BrowserProvider(evmProvider, network.id)
        // Use chain's configured RPC for read-only calls (avoids wallet RPC mismatch with local fork)
        const readProvider = new ethers.JsonRpcProvider(chain.rpcUrl)
        const readContract = new Contract(chain.contractAddress, chain.abi, readProvider)
        return {
            createToken: async (token: { name: string, symbol: string, pool: number, amount?: string }, sig: any) => {
                if (!address)
                    throw Error("Connect wallet")
                const signer = new JsonRpcSigner(provider, address as string)
                const contract = new Contract(chain.contractAddress, chain.abi, signer)
                const createFeeAmount = await readContract.CREATE_TOKEN_FEE_AMOUNT();
                const buyAmt = token.amount && token.amount.trim() !== '' ? token.amount : '0'
                const firstBuyFee = Number(buyAmt) > 0 ? await readContract.getFirstBuyFee(ethers.ZeroAddress) : 0n
                const balance = await readProvider.getBalance(address)
                const value = ethers.parseEther(buyAmt) + createFeeAmount + firstBuyFee
                const deadline = Math.floor(Date.now() / 1000) + 3600
                const args = [token.name, token.symbol, ethers.parseEther(buyAmt), 0n, sig, token.pool, deadline] as const

                // Estimate gas against the read RPC (not the wallet) so we can
                // validate the wallet covers fee + buy + gas ourselves. This
                // avoids the cryptic "missing revert data" estimateGas
                // CALL_EXCEPTION the wallet throws when funds fall a hair short,
                // and lets us surface a clean "Insufficient balance" toast.
                let gasLimit = 1_000_000n
                try {
                    gasLimit = await readContract.createToken.estimateGas(...args, { from: address, value })
                } catch (err: any) {
                    // A revert here with enough value in the wallet is a real
                    // contract error (e.g. paused) — bubble it up. Otherwise the
                    // shortfall is caught by the balance check below.
                    if (balance >= value && err?.code !== 'INSUFFICIENT_FUNDS')
                        throw err
                }
                const feeData = await readProvider.getFeeData()
                const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n
                // 20% headroom on gas so validation matches what the wallet reserves.
                const gasCost = (gasLimit * gasPrice * 12n) / 10n
                const totalCost = value + gasCost
                console.log('[createToken] params:', {
                    name: token.name,
                    symbol: token.symbol,
                    buyAmount: ethers.parseEther(buyAmt).toString(),
                    sig,
                    poolType: token.pool,
                    value: value.toString(),
                    gasLimit: gasLimit.toString(),
                    gasCost: gasCost.toString(),
                    totalCost: totalCost.toString(),
                    balance: balance.toString(),
                    createFeeAmount: createFeeAmount.toString(),
                    firstBuyFee: firstBuyFee.toString(),
                    contractAddress: chain.contractAddress,
                    sender: address,
                })
                if (balance < totalCost)
                    throw Error("Insufficient balance")
                const tx = await contract.createToken(...args, { value, gasLimit })
                console.log('[createToken] tx hash:', tx.hash)
                return tx
            },
            createTokenDirect: async (token: { name: string, symbol: string }, sig: any) => {
                if (!address)
                    throw Error("Connect wallet")
                const signer = new JsonRpcSigner(provider, address as string)
                const contract = new Contract(chain.contractAddress, chain.abi, signer)
                const createFeeAmount = await readContract.CREATE_TOKEN_FEE_AMOUNT();
                const balance = await readProvider.getBalance(address)
                const value = createFeeAmount
                const deadline = Math.floor(Date.now() / 1000) + 3600
                const args = [token.name, token.symbol, sig, deadline] as const

                let gasLimit = 1_000_000n
                try {
                    gasLimit = await readContract.createTokenDirect.estimateGas(...args, { from: address, value })
                } catch (err: any) {
                    if (balance >= value && err?.code !== 'INSUFFICIENT_FUNDS')
                        throw err
                }
                const feeData = await readProvider.getFeeData()
                const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n
                const gasCost = (gasLimit * gasPrice * 12n) / 10n
                const totalCost = value + gasCost
                console.log('[createTokenDirect] params:', {
                    name: token.name,
                    symbol: token.symbol,
                    sig,
                    value: value.toString(),
                    gasLimit: gasLimit.toString(),
                    gasCost: gasCost.toString(),
                    totalCost: totalCost.toString(),
                    balance: balance.toString(),
                    createFeeAmount: createFeeAmount.toString(),
                    contractAddress: chain.contractAddress,
                    sender: address,
                })
                if (balance < totalCost)
                    throw Error("Insufficient balance")
                const tx = await contract.createTokenDirect(...args, { value, gasLimit })
                console.log('[createTokenDirect] tx hash:', tx.hash)
                return tx
            },
            approve: async (token: string) => {
                if (!address)
                    throw Error("Connect wallet")
                const signer = new JsonRpcSigner(provider, address as string)
                const tokenContract = new Contract(token, erc20Abi, signer)
                const tokenRead = new Contract(token, erc20Abi, readProvider)
                const poolInfo = await readContract.tokenPools(token).catch(() => undefined)
                // Spender is the Uniswap router for graduated tokens, else the curve contract.
                let spender = chain.contractAddress
                if (poolInfo?.launched) {
                    const lmAddress = await readContract.liquidityManager()
                    const lm = new Contract(lmAddress, liquidityManagerAbi, readProvider)
                    spender = await lm.getRouterV2()
                }
                // Estimate gas on the read provider (reliable) rather than the
                // wallet, so a flaky wallet RPC can't turn a plain ERC20 approve
                // into a cryptic "missing revert data" estimateGas error; pass the
                // gasLimit so the wallet only signs + broadcasts.
                let gasLimit: bigint
                try {
                    gasLimit = await tokenRead.approve.estimateGas(spender, MaxUint256, { from: address })
                } catch (err: any) {
                    if (err?.code === 'INSUFFICIENT_FUNDS')
                        throw Error("Insufficient balance")
                    throw err
                }
                return await tokenContract.approve(spender, MaxUint256, { gasLimit })
            },
            // How much is claimable right now. There is no on-chain view for this —
            // pending fees only materialise when the position is poked — so simulate
            // the claim and read its return value. Costs nothing and can't revert
            // state; a token with no fees returns zeros.
            getClaimableFees: async (token: string): Promise<{ eth: string, token: string } | undefined> => {
                try {
                    const [ethFees, tokenFees] = await readContract.claimFees.staticCall(token, { from: address ?? ethers.ZeroAddress })
                    return { eth: ethers.formatEther(ethFees), token: ethers.formatEther(tokenFees) }
                } catch {
                    // V2 pools, un-launched tokens, and tokens with no position all
                    // revert here. That's "nothing to claim", not an error worth
                    // surfacing — the caller just hides the button.
                    return undefined
                }
            },
            // Splits 50/50 between the token's creator and the platform on-chain, so
            // whoever pays the gas is irrelevant to where the money lands.
            claimFees: async (token: string) => {
                if (!address)
                    throw Error("Connect wallet")
                const signer = new JsonRpcSigner(provider, address as string)
                const contract = new Contract(chain.contractAddress, chain.abi, signer)
                let gasLimit: bigint
                try {
                    gasLimit = await readContract.claimFees.estimateGas(token, { from: address })
                } catch (err: any) {
                    if (err?.code === 'INSUFFICIENT_FUNDS')
                        throw Error("Insufficient balance")
                    throw Error("No fees to claim")
                }
                return await contract.claimFees(token, { gasLimit })
            },
            buyToken: async (token: string, amount: string, slippage: bigint, exactInput?: boolean) => {
                if (!address)
                    throw Error("Connect wallet")
                const signer = new JsonRpcSigner(provider, address as string)
                const poolInfo = await readContract.tokenPools(token).catch(() => undefined)
                if (!poolInfo || !poolInfo.token || poolInfo.token === ethers.ZeroAddress)
                    throw Error("Invalid token")

                // Native balance + gas price for pre-flight validation. We estimate
                // gas on the READ provider (reliable) rather than the wallet, so a
                // flaky wallet RPC can't turn a valid swap into a cryptic
                // estimateGas CALL_EXCEPTION, and we pass an explicit gasLimit so
                // the wallet only signs + broadcasts.
                const balance = await readProvider.getBalance(address)
                const feeData = await readProvider.getFeeData()
                const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n
                // Throws a clean "Insufficient balance" (surfaced as a toast) when
                // the wallet can't cover value + gas.
                const assertFunds = (value: bigint, gasLimit: bigint) => {
                    if (balance < value + (gasLimit * gasPrice * 12n) / 10n)
                        throw Error("Insufficient balance")
                }
                const estimateOrThrow = async (fn: any, args: any[], value: bigint) => {
                    if (balance < value)
                        throw Error("Insufficient balance")
                    try {
                        return await fn.estimateGas(...args, { from: address, value })
                    } catch (err: any) {
                        if (err?.code === 'INSUFFICIENT_FUNDS')
                            throw Error("Insufficient balance")
                        throw err
                    }
                }

                if (poolInfo.launched) {
                    // Graduated token: route through Uniswap V2
                    const lmAddress = await readContract.liquidityManager()
                    const lm = new Contract(lmAddress, liquidityManagerAbi, readProvider)
                    const [routerAddress, wethAddress] = await Promise.all([lm.getRouterV2(), lm.WETH()])
                    const router = new Contract(routerAddress, uniswapV2RouterAbi, signer)
                    const routerRead = new Contract(routerAddress, uniswapV2RouterAbi, readProvider)
                    const deadline = Math.floor(Date.now() / 1000) + 1200
                    const path = [wethAddress, token]

                    if (exactInput) {
                        const amountInput = ethers.parseEther(amount ?? '0')
                        const amountsOut = await routerRead.getAmountsOut(amountInput, path)
                        const amountOutMin = amountsOut[1] * (10000n - slippage) / 10000n
                        const gasLimit = await estimateOrThrow(routerRead.swapExactETHForTokens, [amountOutMin, path, address, deadline], amountInput)
                        assertFunds(amountInput, gasLimit)
                        return await router.swapExactETHForTokens(amountOutMin, path, address, deadline, { value: amountInput, gasLimit })
                    }
                    const amountOut = ethers.parseEther(amount ?? '0')
                    const amountsIn = await routerRead.getAmountsIn(amountOut, path)
                    const amountInMax = amountsIn[0] * (10000n + slippage) / 10000n
                    const gasLimit = await estimateOrThrow(routerRead.swapETHForExactTokens, [amountOut, path, address, deadline], amountInMax)
                    assertFunds(amountInMax, gasLimit)
                    return await router.swapETHForExactTokens(amountOut, path, address, deadline, { value: amountInMax, gasLimit })
                }

                // Bonding curve swap
                const contract = new Contract(chain.contractAddress, chain.abi, signer)
                const firstBuyFee = await readContract.getFirstBuyFee(token)
                const swapDeadline = Math.floor(Date.now() / 1000) + 1200
                if (exactInput) {
                    const amountInput = ethers.parseEther(amount ?? '0')
                    const value = amountInput + firstBuyFee
                    const amountInWithFee = amountInput * 99n / 100n
                    const estimateAmount = amountInWithFee * poolInfo.virtualTokenReserve / (poolInfo.virtualEthReserve + amountInWithFee)
                    const amountOutMin = estimateAmount * (10000n - slippage) / 10000n
                    const gasLimit = await estimateOrThrow(readContract.swapExactETHForTokens, [token, amountInput, amountOutMin, swapDeadline], value)
                    assertFunds(value, gasLimit)
                    return await contract.swapExactETHForTokens(token, amountInput, amountOutMin, swapDeadline, { value, gasLimit })
                }
                const amountOut = ethers.parseEther(amount ?? '0')
                const amountInWei = amountOut * poolInfo.virtualEthReserve / (poolInfo.virtualTokenReserve - amountOut) + 1n
                const estimateAmount = amountInWei * 100n / 99n
                const amountInMax = estimateAmount * (10000n + slippage) / 10000n
                const value = amountInMax + firstBuyFee
                const gasLimit = await estimateOrThrow(readContract.swapETHForExactTokens, [token, amountOut, amountInMax, swapDeadline], value)
                assertFunds(value, gasLimit)
                return await contract.swapETHForExactTokens(token, amountOut, amountInMax, swapDeadline, { value, gasLimit })
            },
            sellToken: async (token: string, amount: string, slippage: bigint) => {
                if (!address)
                    throw Error("Connect wallet")
                const signer = new JsonRpcSigner(provider, address as string)
                const poolInfo = await readContract.tokenPools(token).catch(() => undefined)
                if (!poolInfo || !poolInfo.token || poolInfo.token === ethers.ZeroAddress)
                    throw Error("Invalid token")

                // Sells send tokens (no ETH value) but still need the token
                // balance to cover the amount and native ETH for gas. Estimate on
                // the read provider so a flaky wallet RPC can't produce a cryptic
                // estimateGas revert; a shortfall surfaces as an "Insufficient
                // balance" toast.
                const amountInput = ethers.parseEther(amount ?? '0')
                const tokenRead = new Contract(token, erc20Abi, readProvider)
                const tokenBalance: bigint = await tokenRead.balanceOf(address).catch(() => 0n)
                if (tokenBalance < amountInput)
                    throw Error("Insufficient balance")
                const estimateSell = async (fn: any, args: any[]) => {
                    try {
                        return await fn.estimateGas(...args, { from: address })
                    } catch (err: any) {
                        if (err?.code === 'INSUFFICIENT_FUNDS')
                            throw Error("Insufficient balance")
                        throw err
                    }
                }

                if (poolInfo.launched) {
                    // Graduated token: route through Uniswap V2
                    const lmAddress = await readContract.liquidityManager()
                    const lm = new Contract(lmAddress, liquidityManagerAbi, readProvider)
                    const [routerAddress, wethAddress] = await Promise.all([lm.getRouterV2(), lm.WETH()])
                    const router = new Contract(routerAddress, uniswapV2RouterAbi, signer)
                    const routerRead = new Contract(routerAddress, uniswapV2RouterAbi, readProvider)
                    const deadline = Math.floor(Date.now() / 1000) + 1200
                    const path = [token, wethAddress]
                    const amountsOut = await routerRead.getAmountsOut(amountInput, path)
                    const amountOutMin = amountsOut[1] * (10000n - slippage) / 10000n
                    const gasLimit = await estimateSell(routerRead.swapExactTokensForETH, [amountInput, amountOutMin, path, address, deadline])
                    return await router.swapExactTokensForETH(amountInput, amountOutMin, path, address, deadline, { gasLimit })
                }

                // Bonding curve swap
                const contract = new Contract(chain.contractAddress, chain.abi, signer)
                const estimateAmount = amountInput * poolInfo.virtualEthReserve / (poolInfo.virtualTokenReserve + amountInput) * 99n / 100n
                const amountOutMin = estimateAmount * (10000n - slippage) / 10000n
                const swapDeadline = Math.floor(Date.now() / 1000) + 1200
                const gasLimit = await estimateSell(readContract.swapExactTokensForETH, [token, amountInput, amountOutMin, swapDeadline])
                return await contract.swapExactTokensForETH(token, amountInput, amountOutMin, swapDeadline, { gasLimit })
            },
            quoteBuy: async (token: string, amount: string, exactInput?: boolean) => {
                const poolInfo = await readContract.tokenPools(token).catch(() => undefined)
                if (!poolInfo || !poolInfo.token || poolInfo.token === ethers.ZeroAddress)
                    throw Error("Invalid token")
                const balance = address ? await readProvider.getBalance(address) : 0n

                if (poolInfo.launched) {
                    // Graduated token: quote via Uniswap V2
                    const lmAddress = await readContract.liquidityManager()
                    const lm = new Contract(lmAddress, liquidityManagerAbi, readProvider)
                    const [routerAddress, wethAddress] = await Promise.all([lm.getRouterV2(), lm.WETH()])
                    const router = new Contract(routerAddress, uniswapV2RouterAbi, readProvider)
                    const path = [wethAddress, token]
                    if (exactInput) {
                        const amountInput = ethers.parseEther(amount ?? '0')
                        if (balance < amountInput)
                            throw Error(`Insufficient ${network.nativeCurrency.symbol} balance`)
                        const amountsOut = await router.getAmountsOut(amountInput, path)
                        return ethers.formatEther(amountsOut[1])
                    }
                    const amountOut = ethers.parseEther(amount ?? '0')
                    const amountsIn = await router.getAmountsIn(amountOut, path)
                    if (balance < amountsIn[0])
                        throw Error(`Insufficient ${network.nativeCurrency.symbol} balance`)
                    return ethers.formatEther(amountsIn[0])
                }

                // Bonding curve quote
                if (exactInput) {
                    const amountInput = ethers.parseEther(amount ?? '0')
                    const amountInWithFee = amountInput * 99n / 100n
                    // The tx sends the FULL amountInput (+ fee) as msg.value, not the
                    // fee-adjusted amount — so validate against amountInput or the
                    // quote passes while the swap fails for insufficient value.
                    if (balance < amountInput)
                        throw Error(`Insufficient ${network.nativeCurrency.symbol} balance`)
                    const estimateAmount = amountInWithFee * poolInfo.virtualTokenReserve / (poolInfo.virtualEthReserve + amountInWithFee)
                    return ethers.formatEther(estimateAmount)
                }
                const amountOut = ethers.parseEther(amount ?? '0')
                const amountInWei = amountOut * poolInfo.virtualEthReserve / (poolInfo.virtualTokenReserve - amountOut) + 1n
                const estimateAmount = amountInWei * 100n / 99n
                if (balance < estimateAmount)
                    throw Error(`Insufficient ${network.nativeCurrency.symbol} balance`)
                return ethers.formatEther(estimateAmount)
            },
            quoteSell: async (token: string, amount: string) => {
                const poolInfo = await readContract.tokenPools(token).catch(() => undefined)
                if (!poolInfo || !poolInfo.token || poolInfo.token === ethers.ZeroAddress)
                    throw Error("Invalid token")

                if (poolInfo.launched) {
                    // Graduated token: quote via Uniswap V2
                    const lmAddress = await readContract.liquidityManager()
                    const lm = new Contract(lmAddress, liquidityManagerAbi, readProvider)
                    const [routerAddress, wethAddress] = await Promise.all([lm.getRouterV2(), lm.WETH()])
                    const router = new Contract(routerAddress, uniswapV2RouterAbi, readProvider)
                    const path = [token, wethAddress]
                    const amountInput = ethers.parseEther(amount ?? '0')
                    const amountsOut = await router.getAmountsOut(amountInput, path)
                    return ethers.formatEther(amountsOut[1])
                }

                // Bonding curve quote
                const amountInput = ethers.parseEther(amount ?? '0')
                const estimateAmount = amountInput * poolInfo.virtualEthReserve / (poolInfo.virtualTokenReserve + amountInput) * 99n / 100n
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
            // if (!address)
            //     return
            // const payer = new PublicKey(address)
            // const poolAccount = await client.state.getPoolByBaseMint(token)
            // if (!poolAccount)
            //     throw Error("Invalid token")
            // let amountIn = new BN(Math.floor(Number(amount) * LAMPORTS_PER_SOL))
            // let minimumAmountOut = new BN(0)
            // const virtualPool = poolAccount.account
            // const poolConfigData = await client.state.getPoolConfig(chain.contractAddress)
            // if (exactInput) {
            //     const quote = await client.pool.swapQuote({
            //         virtualPool: virtualPool,
            //         config: poolConfigData,
            //         swapBaseForQuote: false,
            //         amountIn,
            //         // slippageBps: 200,
            //         hasReferral: false,
            //         currentPoint: new BN(0)
            //     })
            //     minimumAmountOut = quote.amountOut.mul(new BN(10000n - slippage)).div(new BN(10000))
            // } else {
            //     const quote = await client.pool.swapQuoteExactOut({
            //         virtualPool: virtualPool,
            //         config: poolConfigData,
            //         swapBaseForQuote: false,
            //         outAmount: new BN(Math.floor(Number(amount) * 1000000)),
            //         // slippageBps: 200,
            //         hasReferral: false,
            //         currentPoint: new BN(0)
            //     })
            //     amountIn = quote.amountOut.mul(new BN(10000n + slippage)).div(new BN(10000))
            //     minimumAmountOut = new BN(Math.floor(Number(amount) * 1000000))
            // }
            // const buyTx = await client.pool.swap({
            //     payer,
            //     owner: payer,
            //     amountIn,
            //     minimumAmountOut,
            //     swapBaseForQuote: false,
            //     pool: poolAccount.publicKey,
            //     referralTokenAccount: null,
            // })
            // const { blockhash } = await connection.getLatestBlockhash()
            // const tx = new VersionedTransaction(
            //     new TransactionMessage({
            //         payerKey: payer,
            //         recentBlockhash: blockhash,
            //         instructions: buyTx.instructions
            //     }).compileToV0Message()
            // )
            // return await solProvider.sendTransaction(tx, connection)
        },
        sellToken: async (token: string, amount: string, slippage: bigint) => {
            // if (!address)
            //     return
            // const payer = new PublicKey(address)
            // const poolAccount = await client.state.getPoolByBaseMint(token)
            // if (!poolAccount)
            //     throw Error("Invalid token")
            // let amountIn = new BN(Math.floor(Number(amount) * LAMPORTS_PER_SOL))
            // const poolConfigData = await client.state.getPoolConfig(chain.contractAddress)
            // const virtualPool = poolAccount.account
            // const quote = await client.pool.swapQuote({
            //     virtualPool: virtualPool,
            //     config: poolConfigData,
            //     swapBaseForQuote: true,
            //     amountIn: new BN(Math.floor(Number(amount) * 1000000)),
            //     // slippageBps: 200,
            //     hasReferral: false,
            //     currentPoint: new BN(0)
            // })
            // const minimumAmountOut = quote.amountOut.mul(new BN(10000n - slippage)).div(new BN(10000))
            // const sellTx = await client.pool.swap({
            //     payer,
            //     owner: payer,
            //     amountIn,
            //     minimumAmountOut,
            //     swapBaseForQuote: true,
            //     pool: poolAccount.publicKey,
            //     referralTokenAccount: null,
            // })
            // const { blockhash } = await connection.getLatestBlockhash()
            // const tx = new VersionedTransaction(
            //     new TransactionMessage({
            //         payerKey: payer,
            //         recentBlockhash: blockhash,
            //         instructions: sellTx.instructions
            //     }).compileToV0Message()
            // )
            // return await solProvider.sendTransaction(tx, connection)
        },
        quoteBuy: async (token: string, amount: string, exactInput?: boolean) => {
            // const poolAccount = await client.state.getPoolByBaseMint(token)
            // if (!poolAccount)
            //     throw Error("Invalid token")
            // const poolConfigData = await client.state.getPoolConfig(chain.contractAddress)
            // const virtualPool = poolAccount.account
            // if (exactInput) {
            //     const quote = await client.pool.swapQuote({
            //         virtualPool: virtualPool,
            //         config: poolConfigData,
            //         swapBaseForQuote: false,
            //         amountIn: new BN(Math.floor(Number(amount) * LAMPORTS_PER_SOL)),
            //         // slippageBps: 200,
            //         hasReferral: false,
            //         currentPoint: new BN(0)
            //     })
            //     return (quote.amountOut.toNumber() / 1000000).toString()
            // }
            // const quote = await client.pool.swapQuoteExactOut({
            //     virtualPool: virtualPool,
            //     config: poolConfigData,
            //     swapBaseForQuote: false,
            //     outAmount: new BN(Math.floor(Number(amount) * 1000000)),
            //     // slippageBps: 200,
            //     hasReferral: false,
            //     currentPoint: new BN(0)
            // })
            // return (quote.amountOut.toNumber() / LAMPORTS_PER_SOL).toString()
        },
        quoteSell: async (token: string, amount: string) => {
            // const poolAccount = await client.state.getPoolByBaseMint(token)
            // if (!poolAccount)
            //     throw Error("Invalid token")
            // const poolConfigData = await client.state.getPoolConfig(chain.contractAddress)
            // const virtualPool = poolAccount.account
            // const quote = await client.pool.swapQuote({
            //     virtualPool: virtualPool,
            //     config: poolConfigData,
            //     swapBaseForQuote: true,
            //     amountIn: new BN(Math.floor(Number(amount) * 1000000)),
            //     // slippageBps: 200,
            //     hasReferral: false,
            //     currentPoint: new BN(0)
            // })
            // return (quote.amountOut.toNumber() / LAMPORTS_PER_SOL).toString()
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

    const tokenDetails = transformJupiterTokenData(jupiterTokenResponse);

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
        tokenDetails,
        trades,
        tradesCount,
        holdersDetails,
        poolInfo,
        balance: 0n, // User balance - would need Solana wallet connection
        allowance: 0n, // Token allowance - not applicable for Solana
        curveBalance: BigInt(Math.floor((tokenDetails.totalSupply - tokenDetails.circSupply) * Math.pow(10, pool.baseAsset.decimals || 6))),
        tokenContract: null, // No contract for Solana tokens
        isSolana: true
    };
}