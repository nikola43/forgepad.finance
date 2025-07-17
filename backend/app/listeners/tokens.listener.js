const ethers = require('ethers')
// const { AnchorProvider, Program } = require('@coral-xyz/anchor')
const { CHAINS } = require('../config/web3.config')
const db = require("../models/index");
const tokenTable = db.tokens;
const requestTable = db.requests;
const tradeTable = db.trades;
const holderTable = db.holders;
const indexTable = db.indexing;
// const kingsTable = db.kings;
const { Sequelize } = require('sequelize');
const WEBSOCKET_MSGTypes = require('../config/websocket.config');
const http = require('http');
const { Connection, PublicKey } = require('@solana/web3.js');
// const { fetchCandles } = require('../middleware/candles');
// const genRanHex = size => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

function f(x) {
    return 1 / (1 + 0.0000001 * x * x + 0.000006 * x * x * x + 0.00000006 * x * x * x * x)
}

function subscribe(io, chain) {
    const url = new URL(chain.rpcUrl)
    const clientRequest = http.get({
        hostname: url.hostname,
        port: url.port,
        path: '/'
    }, async () => {
        try {
            if (chain.network === 'solana') {
                const connection = new Connection(chain.rpcUrl)
                // const provider = new AnchorProvider(connection)
                // const program = new Program(chain.idl, provider)
                // program.addEventListener(
                //     'EvtSwap',
                //     (event, slot, signature) => {
                //         console.log(`[${chain.network}]`, `Found in tx ${signature}`)
                //         console.log(`[${chain.network}]`, 'Event data:', event)
                //     }
                // )
                connection.onLogs(
                    new PublicKey(chain.contractAddress), 
                    async ({signature, logs}) => {
                        if (logs[1] === 'Program log: Instruction: InitializeVirtualPoolWithSplToken') {
                            const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 })
                            const tokenAddress = new PublicKey(tx.transaction.message.instructions[0].accounts[3]).toBase58()
                            const request = await requestTable.findOne({
                                where: {
                                    address: tokenAddress
                                }
                            })
                            if (request) {
                                io.emit('deployed', JSON.stringify({
                                    ...request.body,
                                    tokenAddress,
                                    txHash: signature
                                }))
                                const createdAt = new Date(Number(tx.blockTime) * 1000)
                                await tokenTable.create({
                                    ...request.body,
                                    tokenAddress,
                                    creationTime: createdAt,
                                    updateTime: createdAt,
                                    createdAt,
                                    updatedAt: createdAt
                                })
                                await requestTable.destroy({
                                    where: {
                                        id: request.id
                                    }
                                })
                            }
                        }
                    }
                )
                console.log("🔔 Subscribing ", chain.contractAddress, "on", chain.network)
            } else {            
                const provider = chain.rpcUrl.startsWith('wss://')
                    ? new ethers.WebSocketProvider(chain.rpcUrl)
                    : new ethers.JsonRpcProvider(chain.rpcUrl)

                const contract = new ethers.Contract(chain.contractAddress, chain.abi, provider)
                console.log("🔔 Subscribing ", chain.contractAddress, "on", chain.network)

                const events = [
                    'TokenCreated',
                    'BuyTokens',
                    'SellTokens',
                    'TokenLaunched'
                ]
                const topics = events.map(e => contract.getEvent(e).fragment.topicHash)

                async function processLogs(fromBlock, toBlock) {
                    let lastIndex = fromBlock ? { block: fromBlock - 1 } : await indexTable.findOne({
                        where: {
                            network: chain.chainId
                        }
                    })
                    fromBlock = lastIndex ? lastIndex.block + 1 : toBlock
                    if (fromBlock === toBlock)
                        console.log(`[${chain.network}]`, 'block:', fromBlock)
                    else
                        console.log(`[${chain.network}]`, 'block range:', fromBlock, '~', toBlock)
                    const logs = await provider.getLogs({
                        address: contract.target,
                        topics: [topics],
                        fromBlock,
                        toBlock
                    }).then(logs =>
                        logs.map(log => ({ ...log, ...contract.interface.parseLog(log) }))
                    ).catch(ex => {
                        console.log(ex.message)
                    })

                    if (logs && logs.length) {
                        console.log(`[${chain.network}]`, `found logs (total: ${logs.length})`)
                        const response = []
                        // const ethPriceUSD = await contract.getETHPriceByUSD()
                        const creations = logs.filter(log => log.name == 'TokenCreated')
                        const newTokens = (await requestTable.findAll({
                            where: {
                                id: {
                                    [Sequelize.Op.in]: creations.map(log => Number(log.args.sig))
                                }
                            }
                        })).map(request => {
                            const body = JSON.parse(request.get('body'))
                            const creation = creations.find(c => Number(c.args.sig) === Number(request.get('id')))
                            if (!creation)
                                return undefined
                            console.log(`[${chain.network}]`, 'deployed', body.tokenName, 'at', creation.args.token)
                            // const ethReserve = creation.ethAmount
                            const ethPriceUSD = ethers.formatEther(creation.args.ethPriceUSD)
                            const price = ethers.formatEther(creation.args.tokenPrice)
                            const createdAt = new Date(Number(creation.args.date) * 1000)
                            io.emit('deployed', JSON.stringify({
                                ...body,
                                tokenAddress: creation.args.token,
                                txHash: creation.transactionHash
                            }))
                            return {
                                ...body,
                                tokenAddress: creation.args.token,
                                marketcap: chain.virtualEthAmount * Number(ethPriceUSD) * chain.totalSupply / chain.virtualTokenAmount,
                                price,
                                ethPrice: ethPriceUSD,
                                virtualEthAmount: chain.virtualEthAmount,
                                virtualTokenAmount: chain.virtualTokenAmount,
                                replies: 0,
                                creationTime: createdAt,
                                updateTime: createdAt,
                                createdAt,
                                updatedAt: createdAt
                            }
                        }).filter(Boolean)

                        await requestTable.destroy({
                            where: {
                                id: {
                                    [Sequelize.Op.in]: creations.map(c => Number(c.args.sig)).filter(Boolean)
                                }
                            }
                        })

                        if (newTokens.length) {
                            response.push(
                                ...newTokens.map(token => ({
                                    type: WEBSOCKET_MSGTypes.createToken,
                                    data: token
                                }))
                            )
                            await tokenTable.bulkCreate(newTokens, {
                                updateOnDuplicate: ['tokenAddress']
                            }).catch(ex => console.error(ex))
                        }

                        const tokens = await tokenTable.findAll({
                            where: {
                                tokenAddress: {
                                    [Sequelize.Op.in]: logs.map(log => log.args.token).filter(Boolean)
                                }
                            },
                            raw: true
                        })
                        const holders = await holderTable.findAll({
                            where: {
                                holderAddress: {
                                    [Sequelize.Op.in]: logs.map(log => log.args.user).filter(Boolean)
                                },
                                tokenAddress: {
                                    [Sequelize.Op.in]: logs.map(log => log.args.token).filter(Boolean)
                                }
                            },
                            raw: true
                        })
                        const trades = []
                        // const referrals = []
                        for (const log of logs) {
                            const token = tokens.find(t => t.tokenAddress == log.args.token)
                            if (!token)
                                continue
                            //     const now = new Date(fromBlock==toBlock ? Date.now() : (await provider.getBlock(log.blockNumber)).timestamp * 1000)
                            if (log.name === 'BuyTokens') {
                                const swapperAddress = log.args.user
                                // const price = log.args.tokenPrice * log.args.ethPriceUSD / (10n ** 18n)
                                token.ethPrice = ethers.formatEther(log.args.ethPriceUSD)
                                token.marketcap = ethers.formatEther(log.args.marketCap)
                                token.price = ethers.formatEther(log.args.tokenPrice)
                                token.virtualEthAmount = ethers.formatEther(ethers.parseEther(String(token.virtualEthAmount)) + log.args.ethAmount)
                                token.virtualTokenAmount = ethers.formatEther(ethers.parseEther(String(token.virtualTokenAmount)) - log.args.tokenAmount)
                                const volume = log.args.tokenAmount * log.args.ethPriceUSD * log.args.tokenPrice / ethers.parseUnits('1', 36)
                                token.volume = ethers.formatEther(ethers.parseEther(String(token.volume)) + volume)
                                const now = new Date(Number(log.args.date) * 1000)
                                const last = new Date(token.updatedAt)
                                token.score = (Number(token.score) * f(Math.max(0, now - last) * 100 / 1800) + Number(ethers.formatEther(volume))).toFixed(8)
                                const holder = holders.find(h => h.tokenAddress == token.tokenAddress && h.holderAddress == swapperAddress)
                                if (!holder) {
                                    holders.push({
                                        tokenName: token.tokenName,
                                        tokenSymbol: token.tokenSymbol,
                                        creatorAddress: token.creatorAddress,
                                        tokenAddress: token.tokenAddress,
                                        holderAddress: swapperAddress,
                                        tokenAmount: ethers.formatEther(log.args.tokenAmount),
                                        network: chain.network,
                                    })
                                } else {
                                    holder.tokenAmount = ethers.formatEther(ethers.parseEther(holder.tokenAmount) + log.args.tokenAmount)
                                }
                                console.log(`[${chain.network}]`, swapperAddress.slice(0, 6), 'bought', token.tokenSymbol, `(vol: $${Number(ethers.formatEther(volume)).toFixed(2)})`)
                                trades.push({
                                    tokenName: token.tokenName,
                                    tokenSymbol: token.tokenSymbol,
                                    tokenAddress: token.tokenAddress,
                                    tokenImage: token.tokenImage,
                                    swapperAddress: swapperAddress,
                                    type: 'BUY',
                                    ethAmount: ethers.formatEther(log.args.ethAmount),
                                    tokenAmount: ethers.formatEther(log.args.tokenAmount),
                                    network: chain.network,
                                    txHash: log.transactionHash,
                                    ethPrice: ethers.formatEther(log.args.ethPriceUSD),
                                    tokenPrice: token.price,
                                    date: log.args.date
                                })
                                // if (referrals[swapperAddress])
                                //     referrals[swapperAddress] += ethers.formatUnits(log.args.tokenAmount * price, 36)
                                // else
                                //     referrals[swapperAddress] = ethers.formatUnits(log.args.tokenAmount * price, 36)
                            } else if (log.name === 'SellTokens') {
                                const swapperAddress = log.args.user
                                // const price = log.args.tokenPrice * log.args.ethPriceUSD / (10n ** 18n)
                                token.ethPrice = ethers.formatEther(log.args.ethPriceUSD)
                                token.marketcap = ethers.formatEther(log.args.marketCap)
                                token.price = ethers.formatEther(log.args.tokenPrice)
                                token.virtualEthAmount = ethers.formatEther(ethers.parseEther(String(token.virtualEthAmount)) - log.args.ethAmount)
                                token.virtualTokenAmount = ethers.formatEther(ethers.parseEther(String(token.virtualTokenAmount)) + log.args.tokenAmount)
                                const volume = log.args.tokenAmount * log.args.ethPriceUSD * log.args.tokenPrice / ethers.parseUnits('1', 36)
                                token.volume = ethers.formatEther(ethers.parseEther(String(token.volume)) + volume)
                                const now = new Date(Number(log.args.date) * 1000)
                                const last = new Date(token.updatedAt)
                                token.score = (Number(token.score) * f(Math.max(0, now - last) * 100 / 1800) + Number(ethers.formatEther(volume))).toFixed(8)
                                const holder = holders.find(h => h.tokenAddress == token.tokenAddress && h.holderAddress == swapperAddress)
                                if (holder) {
                                    holder.tokenAmount = ethers.formatEther(ethers.parseEther(holder.tokenAmount) - log.args.tokenAmount)
                                }
                                console.log(`[${chain.network}]`, swapperAddress.slice(0, 6), 'sell', token.tokenSymbol, `(vol: $${Number(ethers.formatEther(volume)).toFixed(2)})`)
                                trades.push({
                                    tokenName: token.tokenName,
                                    tokenSymbol: token.tokenSymbol,
                                    tokenAddress: token.tokenAddress,
                                    tokenImage: token.tokenImage,
                                    swapperAddress: swapperAddress,
                                    type: 'SELL',
                                    ethAmount: ethers.formatEther(log.args.ethAmount),
                                    tokenAmount: ethers.formatEther(log.args.tokenAmount),
                                    network: chain.network,
                                    txHash: log.transactionHash,
                                    ethPrice: ethers.formatEther(log.args.ethPriceUSD),
                                    tokenPrice: token.price,
                                    date: log.args.date
                                })
                            } else if (log.name === 'TokenLaunched') {
                                token.launchedAt = new Date(Number(log.args.date) * 1000)
                                // const routers = ['9INCH', '9mm', 'PulseX']
                                token.pairAddress = log.args.pair;
                            }
                        }
                        if (tokens.length) {
                            await tokenTable.bulkCreate(tokens, {
                                updateOnDuplicate: ['price', 'ethPrice', 'virtualEthAmount', 'virtualTokenAmount', 'marketcap', 'launchedAt', 'pairAddress', 'volume', 'score']
                            })
                            // const king = await kingsTable.findOne({
                            //     order: [['createdAt', 'DESC']]
                            // })
                            // const newKing = await tokenTable.findOne({
                            //     where: {
                            //         launchedAt: null,
                            //         marketcap: {
                            //             [Sequelize.Op.gt]: 0
                            //         }
                            //     },
                            //     order: [['marketcap', 'DESC']]
                            // })
                            // if (newKing && (!king || newKing.tokenAddress != king.tokenAddress)) {
                            //     await kingsTable.create({
                            //         tokenAddress: newKing.tokenAddress
                            //     })
                            // }
                        }
                        if (holders.length)
                            await holderTable.bulkCreate(holders, {
                                updateOnDuplicate: ['tokenAmount']
                            })
                        if (trades.length) {
                            // console.log('trades', trades)
                            await tradeTable.bulkCreate(trades, {
                                ignoreDuplicates: true
                            })
                            // await db.sequelize.query(`
                            //     UPDATE trades a
                            //         LEFT JOIN referrals b ON a.swapperAddress = b.referrer
                            //         LEFT JOIN referral_infos c ON c.address = b.referee
                            //     SET c.earnings = c.earnings + a.ethAmount * a.ethPrice
                            //     WHERE a.txHash IN (?)
                            // `, {
                            //     replacements: trades.filter(t => t.type=='BUY').map(t => t.txHash)
                            // })
                            response.push(
                                ...trades.map(trade => ({
                                    type: WEBSOCKET_MSGTypes.swap,
                                    data: trade
                                }))
                            )
                            io.emit('m', trades.map(t => `${t.tokenAddress}~${t.date}~${t.tokenPrice}~${Number(t.tokenPrice * t.ethPrice * t.tokenAmount).toFixed(2)}`).join('\n'))
                            // io.emit('trade', JSON.stringify(trades.map(t => ({
                            //     network: t.network,
                            //     tokenAddress: t.tokenAddress,
                            //     tokenImage: t.tokenImage,
                            //     tokenSymbol: t.tokenSymbol,
                            //     swapperAddress: t.swapperAddress,
                            //     tokenPrice: t.tokenPrice,
                            //     tokenAmount: t.tokenAmount,
                            //     ethAmount: t.ethAmount,
                            //     type: t.type,
                            //     date: t.date.toString(),
                            // }))))
                        }
                        // if (response.length)
                        //     io.emit('message', JSON.stringify({
                        //         type: WEBSOCKET_MSGTypes.batch,
                        //         // data: response
                        //     }))
                    }
                }

                let lastIndex = await indexTable.findOne({
                    where: {
                        network: chain.chainId
                    }
                }).catch(() => undefined)

                if (lastIndex) {
                    const fromBlock = lastIndex.block + 1
                    while (true) {
                        const toBlock = await provider.getBlockNumber()
                        if (fromBlock < toBlock) {
                            for (let blockNumber = fromBlock; blockNumber < toBlock; blockNumber += 50000) {
                                await processLogs(blockNumber, Math.min(toBlock, blockNumber + 50000)).catch(() => { })
                                await indexTable.upsert({
                                    network: chain.chainId,
                                    block: Math.min(toBlock, blockNumber + 50000)
                                })
                            }
                            break
                        }
                    }
                } else {
                    const toBlock = await provider.getBlockNumber()
                    await indexTable.upsert({
                        network: chain.chainId,
                        block: toBlock
                    })
                }

                let lastBlockNumber = undefined

                provider.on('block', async (blockNumber) => {
                    processLogs(lastBlockNumber, blockNumber).then(() =>
                        indexTable.upsert({
                            network: chain.chainId,
                            block: blockNumber
                        })
                    )
                    lastBlockNumber = blockNumber + 1
                })

                if (provider.websocket) {
                    provider.websocket.on('close', () => {
                        console.log('⚠️ reconnecting')
                        setTimeout(() => subscribe(io), 10000)
                    })
                }
            }
        } catch (e) {
            console.error(e)
            setTimeout(() => subscribe(io, chain), 10000)
        }
    })
    clientRequest.on('error', () => {
        console.log('⚠️ reconnecting')
        setTimeout(() => subscribe(io, chain), 10000)
    })
}

module.exports = io => {
    // setInterval(() => {
    //     Object.keys(io.channels).forEach(tokenAddress => {
    //         fetchCandles(tokenAddress, undefined, undefined, 1, false, 1).then(candles => {
    //             if (candles?.length && lastBar[tokenAddress]?.time != candles[0].time && lastBar[tokenAddress]?.volume != candles[0].volume) {
    //                 io.emit('m', `${tokenAddress}~${candles[0].time}~${candles[0].close}~${candles[0].volume}`)
    //                 lastBar[tokenAddress] = candles[0]
    //             }
    //         }).catch(err => { console.error('Error fetching candles:', err)})
    //     })
    // }, 1000)
    CHAINS.forEach(chain => subscribe(io, chain))
}