// const { btoa } = require("buffer");
// const bcrypt = require('bcrypt');
// const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const db = require("../models/index");
const Sequelize = require("sequelize");
const { fetchCandles } = require('../middleware/candles');
const { CHAINS } = require('../config/web3.config');
// const sequelize = db.sequelize;
const tradeTable = db.trades;
const tokenTable = db.tokens;
const userTable = db.users;

module.exports = {
    async getAllTradesByToken(req, res) {
        try {
            const { tokenAddress } = req.body;

            const tradeList = await tradeTable.findAll({
                where: {
                    tokenAddress: tokenAddress,
                    // network: network
                }
            });

            res.status(200).json(tradeList);
        } catch (error) {
            res.status(500).json({ error: 'Get Chats Error:', message: error });
        }
    },
    async getLatestTrades(req, res) {
        try {
            const { latestTradeId, latestTokenId } = req.query
            tradeTable.hasOne(userTable, { sourceKey: 'swapperAddress', foreignKey: 'address' })
            const trades = await tradeTable.findAll({
                include: [{
                    model: userTable
                }],
                where: latestTradeId > 0 ? {
                    id: {
                        [Sequelize.Op.gt]: latestTradeId
                    }
                } : undefined,
                order: [['date', 'DESC']],
                limit: latestTradeId > 0 ? undefined : 50
            });
            tokenTable.hasOne(userTable, { sourceKey: 'creatorAddress', foreignKey: 'address' })
            const tokens = await tokenTable.findAll({
                include: [{
                    model: userTable
                }],
                where: latestTokenId > 0 ? {
                    id: {
                        [Sequelize.Op.gt]: latestTokenId
                    }
                } : undefined,
                order: [['createdAt', 'DESC']],
                limit: latestTokenId > 0 ? undefined : 1
            });
            res.status(200).json({ trades, tokens });
        } catch (error) {
            console.log(error);
            res.status(500).json({ error: 'Get latest events error:', message: error });
        }
    },
    
    async getChartData(req, res) {
        const { tokenAddress, interval, from, to, first, dex } = req.query;

        const launched = false;

        if (launched) {
            const RESOLUTIONS = {
                'm': 1, 'd': 1440, 'w': 10080, 'month': 302400, 'y': 525600
            }
            const match = /^(\d*)(\D*)$/.exec(interval.toLowerCase())
            const resolution = Number(match?.[1] ?? 1) * Number(match?.[2] ? RESOLUTIONS[match[2]] : 1)
            fetchCandles(
                tokenAddress, from, to, resolution, first, dex
            ).then(candles => {
                res.status(200).json(candles)
            }).catch((err) => {
                console.log(err)
                return res.status(200).json();
            })
        } else {
            const token = await tokenTable.findOne({
                where: {
                    tokenAddress
                }
            })
            if (new Date(token.createdAt).getTime() / 1000 > to)
                return res.status(200).end('nodata')
            const tradeList = await tradeTable.findAll({
                where: {
                    tokenAddress,
                    // network: "sepolia"
                },
                order: [
                    ['createdAt', 'ASC'],
                ],
            });

            const RESOLUTIONS = {
                's': 1, 'd': 86400, 'w': 604800, 'm': 2592000, 'y': 31536000
            }
            const match = /^(\d*)(\D*)$/.exec(interval.toLowerCase())
            const resolution = Number(match?.[1] ?? 1) * Number(match?.[2] ? RESOLUTIONS[match[2]] : 60)
            const chain = CHAINS.find(chain => chain.network === token.get('network'))
            const initPrice = chain.virtualEthAmount / chain.virtualTokenAmount
            const initCandle = {
                time: Math.floor(new Date(token.createdAt).getTime() / 1000 / resolution) * resolution,
                open: initPrice,
                close: initPrice,
                high: initPrice,
                low: initPrice,
                volume: 0
            }

            if (tradeList.length === 0) {
                return res.status(200).json([initCandle]);
            }
            const candles = tradeList.reduce((candles, row) => {
                try {
                    const time = Math.floor(row.date / resolution) * resolution
                    const last = candles.length > 0 ? candles[candles.length - 1] : undefined
                    if(last?.time==time) {
                        last.high = Math.max(last.high, row.tokenPrice)
                        last.low = Math.min(last.low, row.tokenPrice)
                        last.close = row.tokenPrice
                        last.volume += row.tokenAmount * row.tokenPrice * row.ethPrice
                    } else {
                        candles.push({
                            time,
                            open: last?.close ?? row.tokenPrice,
                            close: row.tokenPrice,
                            high: row.tokenPrice,
                            low: row.tokenPrice,
                            volume: row.tokenAmount * row.tokenPrice * row.ethPrice
                        })
                    }
                } catch(ex) {
                    console.error(ex)
                }
                return candles
            }, [initCandle])
            res.status(200).json(candles);
        }
    },
    async getLatestTrade(req, res) {
        const tradeList = await tradeTable.findAll({
            order: [
                ['createdAt', 'DESC'],
            ],
            limit: 1
        });
        if (tradeList.length === 0) {
            return res.status(200).json();
        }
        res.status(200).json(tradeList[0]);
    }

}