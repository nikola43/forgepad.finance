const EXCHANGE_9INCH_ENDPOINT = 'https://node.9inch.io/subgraphs/name/exchange-pulsechain'
const EXCHANGE_PULSEX_ENDPOINT = 'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2'
const EXCHANGE_9MM_ENDPOINT = 'https://graph.9mm.pro/subgraphs/name/pulsechain/9mm'
const WPLS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

// const NodeCache = require( "node-cache" );
const { default: axios } = require("axios");
// const db = require("../models");
// const candleCache = new NodeCache()
// const tokenTable = db.tokens;
// const blockCache = {}

// class Parser {
//     constructor(blob) {
//         this.buf = Buffer.from(blob)
//         this.pos = 0
//     }

//     parse() {
//         const candles = []
//         if (this.text() == "1.0.0") {
//             try {
//                 this.skip()
//                 const length = this.long(2)
//                 if (this.buf[this.pos - 1] == 0)
//                     this.back()
//                 for (let i = 0; i < length; i++) {
//                     const time = this.double() / 1000
//                     const openNative = this.text()
//                     this.skip()
//                     const open = this.text();
//                     const highNative = this.text()
//                     this.skip()
//                     const high = this.text();
//                     const lowNative = this.text()
//                     this.skip()
//                     const low = this.text();
//                     const closeNative = this.text()
//                     this.skip()
//                     const close = this.text();
//                     this.skip()
//                     const volume = this.text()
//                     const minBlock = this.double()
//                     const maxBlock = this.double()
//                     // console.log({
//                     //     time, open, high, low, close, volume, minBlock, maxBlock
//                     // })
//                     candles.push({
//                         time, open, high, low, close, volume, minBlock, maxBlock
//                     })
//                 }
//             } catch (ex) {
//                 // console.log('err', ex, this.pos)
//             }
//         }
//         return candles
//     }
//     long(bytes = 2) {
//         const pos = this.pos
//         this.pos += bytes
//         return this.buf.readUintLE(pos, bytes) / 2
//     }
//     text() {
//         const len = this.long(1)
//         const pos = this.pos
//         this.pos += len
//         return this.buf.toString('utf8', pos, this.pos)
//     }
//     double() {
//         const pos = this.pos
//         this.pos += 8
//         return this.buf.readDoubleLE(pos)
//     }
//     skip(n = 1) {
//         this.pos += n
//     }
//     back(n = 1) {
//         this.pos -= n
//     }
// }

module.exports = {
    async fetchCandles(address, from, to, interval, first, dex, count = 1000) {
        // const token = await tokenTable.findOne({
        //     where: {
        //         tokenAddress: address
        //     }
        // })
        if(from >= to)
            return 'nodata'
        const endpoints = {
            "9INCH": EXCHANGE_9INCH_ENDPOINT,
            "PulseX": EXCHANGE_PULSEX_ENDPOINT,
            "9mm": EXCHANGE_9MM_ENDPOINT
        }
        if(!!dex && endpoints[dex]) {
            const { data: { data: { pair } } } = await axios.post(endpoints[dex], {
                query: `query ($PAIR: ID!, $COUNT: Int!) {
                    pair(id: $PAIR) {
                        token0 {
                            id
                        }
                        token1 {
                            id
                        }
                        ${
                            !!from && !!to && count > 1 ?
                            `
                                swaps(orderBy: timestamp, orderDirection: desc, first: $COUNT, timestamp_gte: ${from}, timestamp_lte: ${to}) {
                                    timestamp
                                    amountUSD
                                    amount0In
                                    amount0Out
                                    amount1In
                                    amount1Out
                                }
                            ` : ''
                        }
                        last:swaps(orderBy: timestamp, orderDirection: desc, first: 1) {
                            timestamp
                            amountUSD
                            amount0In
                            amount0Out
                            amount1In
                            amount1Out
                        }
                    }
                }`,
                variables: {
                    PAIR: String(address).toLowerCase(), COUNT: Number(count)
                }
            }).catch(ex => console.log(ex))
            if(pair?.swaps) {
                const candles = pair.swaps.reverse().reduce((candles, row) => {
                    try {
                        const time = Math.floor(row.timestamp / interval) * interval
                        const last = candles.length > 0 ? candles[candles.length - 1] : undefined
                        const isZero = pair.token1.id == WPLS.toLowerCase()
                        const amountToken = isZero ? Math.max(row.amount0In, row.amount0Out) : Math.max(row.amount1In, row.amount1Out)
                        const price = row.amountUSD / amountToken
                        if(last?.time==time) {
                            last.high = Math.max(last.high, price)
                            last.low = Math.min(last.low, price)
                            last.close = price
                            last.volume += Number(row.amountUSD)
                        } else {
                            candles.push({
                                time,
                                open: last?.close ?? price,
                                close: price,
                                high: price,
                                low: price,
                                volume: Number(row.amountUSD)
                            })
                        }
                    } catch(ex) {
                        console.log(ex)
                    }
                    return candles
                }, [])
                return candles
            } else if(pair?.last) {
                const isZero = pair.token1.id == WPLS.toLowerCase()
                const [row] = pair.last
                const amountToken = isZero ? Math.max(row.amount0In, row.amount0Out) : Math.max(row.amount1In, row.amount1Out)
                const price = row.amountUSD / amountToken
                return [{
                    time: row.timestamp,
                    close: price,
                    volume: Number(row.amountUSD)
                }]
            }
        }
        return "nodata"
        // const params = new URLSearchParams({
        //     res: interval,
        //     cb: count,
        //     q: WPLS,
        // })
        // if(!first) {
        //     if(blockCache[to])
        //         params.append('bbn', blockCache[to])
        //     else {
        //         const { data: blocks } = to ? await axios.post(BLOCKS_ENDPOINT, {
        //             query: `query {
        //                 bbn: blocks(
        //                     where: {timestamp_lte: "${to}"}
        //                     first: 1
        //                     orderBy: timestamp
        //                     orderDirection: desc
        //                 ) {
        //                     number
        //                 }
        //             }`
        //         }) : {}
        //         const bbn = blocks?.data?.bbn?.[0].number
        //         // const abn = blocks?.data?.abn?.[0].number
        //         if(bbn && bbn < PULSECHAIN_CONTRACT_BLOCK)
        //             return 'nodata'
        //         if(bbn) params.append('bbn', bbn)
        //         // if(abn) params.append('abn', abn)
        //     }
        // }
        // console.log(`${address}?${params.toString()}`)
        // const candles = await fetch(`${DEXSCREENER_API}/${address}?${params.toString()}`, {
        //     mode: "no-cors"
        // }).then(res => res.blob()).then(blob => blob.arrayBuffer()).then(buf => {
        //     return new Parser(buf).parse()
        // })
        // candles?.forEach((candle) => {
        //     blockCache[candle.time] = candle.minBlock
        // })
        // return candles
    }
}