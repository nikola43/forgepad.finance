const { Buffer } = require("buffer");
// const bcrypt = require('bcrypt');
const Sequelize = require("sequelize");
// const jwt = require('jsonwebtoken');
const util = require('ethereumjs-util')
const dotenv = require('dotenv');

dotenv.config();

const db = require("../models/index");
const { CHAINS } = require("../config/web3.config");
const userTable = db.users;
const tokenTable = db.tokens;
const holderTable = db.holders;
const tradeTable = db.trades;
// const chatTable = db.chats;
const requestTable = db.requests;
// const kingTable = db.kings;
const adminTable = db.admins;

const CATEGORIES = {
    "normal": 0,
    "NSFW": 1,
}

module.exports = {
    async createToken(req, res) {
        try {
            const body = req.body

            // if (signature) {
            // const sig = util.fromRpcSig(signature);
            // const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
            // const prefixedMsg = util.keccak256(
            //     Buffer.concat([prefix, Buffer.from(String(msg.length)), Buffer.from(msg)])
            // );

            // const pubKey = util.ecrecover(prefixedMsg, sig.v, sig.r, sig.s);
            // const addrBuf = util.pubToAddress(pubKey);
            // const address = util.toChecksumAddress(util.bufferToHex(addrBuf));

            if (!body.tokenAddress) {
                const request = await requestTable.create({
                    address: body.mintAddress ?? body.creatorAddress, body: JSON.stringify(body),
                })

                res.status(200).json({
                    success: true, sig: request.id
                })
            } else {
                const token = await tokenTable.findOne({
                    where: {
                        tokenAddress: body.tokenAddress,
                        creatorAddress: body.creatorAddress
                    }
                })
                if (!token)
                    throw new Error("No token to update")
                if (body.tokenBanner)
                    token.tokenBanner = body.tokenBanner
                if (body.telegramLink)
                    token.telegramLink = body.telegramLink
                if (body.twitterLink)
                    token.twitterLink = body.twitterLink
                if (body.webLink)
                    token.webLink = body.webLink
                await token.save()
                res.status(200).json({
                    success: true
                })
            }
            // } else {
            //     const request = await requestTable.findByPk(body.sig)
            //     if (request) {
            //         await tokenTable.create(body)
            //         await request.destroy()
            //     }
            //     res.status(200).json({
            //         success: true
            //     })
            // }
        } catch (error) {
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async moveToken(req, res) {
        const { tokenAddress } = req.params
        const { signature, msg, category } = req.body
        try {
            if (signature) {
                const sig = util.fromRpcSig(signature);
                const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
                const prefixedMsg = util.keccak256(
                    Buffer.concat([prefix, Buffer.from(String(msg.length)), Buffer.from(msg)])
                );

                const pubKey = util.ecrecover(prefixedMsg, sig.v, sig.r, sig.s);
                const addrBuf = util.pubToAddress(pubKey);
                const address = util.toChecksumAddress(util.bufferToHex(addrBuf));

                const admin = await adminTable.findOne({
                    where: {
                        address
                    }
                })
                if (!admin)
                    throw new Error("Only administrator can move token!")
                await tokenTable.update({
                    category: CATEGORIES[category]
                }, {
                    where: {
                        tokenAddress
                    }
                })
                res.status(200).json({
                    success: true
                })
            }
        } catch (error) {
            res.status(500).json({ error: 'Error', message: error.message });
        }
    },
    async getAllTokens(req, res) {
        try {
            // const { orderType = 'createdAt', orderFlag = 'DESC', searchWord, network, pageNumber = 1 } = req.body;
            //const orderType = 'updatedAt';
            const orderType = req.query.orderType || 'bump'
            const orderFlag = req.query.orderFlag || 'DESC'
            const searchWord = req.query.searchWord
            const network = req.query.network
            const includeNSFW = req.query.includeNSFW == 'true';
            const pageNumber = req.query.pageNumber || 1;
            const pageSize = Number(req.query.pageSize) || 30;
            // Determine the sorting direction
            const where = {
                ...(
                    !network || network === "all" ? {} : { network }
                ),
                ...(
                    includeNSFW ? {} : { category: 0 }
                ),
                ...(
                    searchWord
                        ? {
                            [Sequelize.Op.or]: [
                                { tokenName: { [Sequelize.Op.like]: `%${searchWord}%` } },
                                { tokenSymbol: { [Sequelize.Op.like]: `%${searchWord}%` } },
                                { tokenAddress: { [Sequelize.Op.like]: `%${searchWord}%` } },
                                { creatorAddress: { [Sequelize.Op.like]: `%${searchWord}%` } },
                            ]
                        }
                        : {}
                )
            }
            const order = [
                orderType === 'trends' || orderType === 'bump'
                    ? [Sequelize.literal("score / (1 + 0.0000001 * x * x + 0.000006 * x * x * x + 0.00000006 * x * x * x * x)"), orderFlag]
                    : [orderType, orderFlag]
            ]
            const offset = (pageNumber - 1) * pageSize;

            // Recommened token for top show - highest marketcap
            // kingTable.hasOne(tokenTable, { sourceKey: 'tokenAddress', foreignKey: 'tokenAddress' })
            // tokenTable.hasMany(tradeTable, { sourceKey: 'tokenAddress', foreignKey: 'tokenAddress' })
            // tokenTable.hasOne(userTable, { sourceKey: 'creatorAddress', foreignKey: 'address' })

            // const king = await kingTable.findOne({
            //     include: [{
            //         model: tokenTable,
            //         include: [{
            //             model: userTable,
            //         }],
            //     }],
            //     order: [['createdAt', 'DESC']]
            // });

            const tokenCount = await tokenTable.count({
                // include: [{
                //     model: userTable,
                // }],
                where,
            });
            const tokenList = await tokenTable.findAll({
                // include: [{
                //     model: userTable,
                // }],
                attributes: orderType === 'trends' || orderType === 'bump' ? {
                    include: [
                        [Sequelize.literal('(UNIX_TIMESTAMP(now()) - UNIX_TIMESTAMP(updatedAt)) * 100 / 1800'), 'x']
                    ]
                } : {},
                where,
                order,
                limit: pageSize,
                offset,
            });

            res.status(200).json({ tokenList, tokenCount });
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async myTokens(req, res) {
        try {
            const { network, userAddress } = req.body;
            tokenTable.hasOne(userTable, { sourceKey: 'creatorAddress', foreignKey: 'address' })
            const tokenList = await tokenTable.findAll({
                include: [{
                    model: userTable,
                }],
                where: {
                    creatorAddress: userAddress, network: network === "ALL" ? undefined : network
                }
            });
            res.status(200).json(tokenList);
        } catch (error) {
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async getTokenDetails(req, res) {
        try {
            const { network, tokenAddress } = req.params;
            const { pageNumber = 1, pageSize = 10 } = req.query;

            // kingTable.hasOne(tokenTable, { sourceKey: 'tokenAddress', foreignKey: 'tokenAddress' })
            // const king = await kingTable.findOne({
            //     include: [{
            //         model: tokenTable,
            //     }],
            //     order: [['createdAt', 'DESC']]
            // });
            // tokenTable.hasOne(userTable, { sourceKey: 'creatorAddress', foreignKey: 'address' })
            const tokenDetils = await tokenTable.findOne({
                // include: [{
                //     model: userTable,
                // }],
                where: {
                    tokenAddress,
                    network
                }
            });

            const trade15m = await tradeTable.findOne({
                attributes: [
                    'tokenPrice'
                ],
                where: {
                    tokenAddress, createdAt: { [Sequelize.Op.lt]: Sequelize.literal('NOW() - INTERVAL 15 MINUTE') },
                },
                order: [['date', 'DESC']],
            })

            const trade1d = await tradeTable.findOne({
                attributes: [
                    [Sequelize.literal('SUM(IF(type="BUY", ethAmount, -ethAmount))'), 'liquidity']
                ],
                where: {
                    tokenAddress, createdAt: { [Sequelize.Op.gte]: Sequelize.literal('NOW() - INTERVAL 1 DAY') }
                }
            })

            // const tradeAll = await tradeTable.findOne({
            //     attributes: [
            //         [Sequelize.literal('SUM(IF(type="BUY", ethAmount, -ethAmount))'), 'liquidity'],
            //         [Sequelize.literal('SUM(tokenAmount * tokenPrice * ethPrice)'), 'volume'],
            //     ],
            //     where: {
            //         tokenAddress
            //     }
            // })
            const chain = CHAINS.find(chain => chain.network === network)
            const price15m = Number(tokenDetils.get('price')) - (trade15m ? Number(trade15m.get('tokenPrice')) : chain.virtualEthAmount / chain.virtualTokenAmount)
            tokenDetils.setDataValue('price15m', price15m.toFixed(12))
            tokenDetils.setDataValue('priceChange15m', (price15m * 100 / Number(tokenDetils.get('price'))).toFixed(2))
            if (trade1d) {
                tokenDetils.setDataValue('liquidity1d', trade1d.get('liquidity'))
            }

            // holderTable.hasOne(userTable, { sourceKey: 'holderAddress', foreignKey: 'address' })
            const holdersDetails = await holderTable.findAll({
                // include: [{
                //     model: userTable
                // }],
                where: {
                    tokenAddress: tokenAddress,
                    tokenAmount: { [Sequelize.Op.gt]: 0 },
                    network: network
                }
            });
            // tradeTable.hasOne(userTable, { sourceKey: 'swapperAddress', foreignKey: 'address' })
            const tradesCount = await tradeTable.count({
                where: {
                    tokenAddress: tokenAddress,
                    network: network
                }
            })
            const trades = await tradeTable.findAll({
                // include: [{
                //     model: userTable
                // }],
                where: {
                    tokenAddress: tokenAddress,
                    network: network
                },
                order: [['createdAt', 'DESC']],
                offset: (Number(pageNumber) - 1) * Number(pageSize),
                limit: Number(pageSize)
            });

            // chatTable.hasOne(userTable, { sourceKey: 'replyAddress', foreignKey: 'address' })
            // const chatList = await chatTable.findAll({
            //     include: [{
            //         model: userTable
            //     }],
            //     where: {
            //         tokenAddress: tokenAddress,
            //         network: network
            //     },
            //     order: [
            //         ['code', 'ASC'],
            //         ['date', 'ASC']
            //     ]
            // });

            res.status(200).json({ tokenDetils, trades, tradesCount, holdersDetails });
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async uploadLogo(req, res) {
        if (!req.file) {
            return res.status(400).send({ message: 'No file uploaded.' });
        }
        res.send({
            message: 'File uploaded successfully.',
            file: req.file
        });
    }
}