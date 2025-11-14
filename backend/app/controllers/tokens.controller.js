const { Buffer } = require("buffer");
// const bcrypt = require('bcrypt');
const Sequelize = require("sequelize");
// const jwt = require('jsonwebtoken');
const util = require('ethereumjs-util')
const dotenv = require('dotenv');

dotenv.config();

const db = require("../models/index");
const { CHAINS } = require("../config/web3.config");
const { getSupabasePublicUrl } = require("../config/s3.config");
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

            // Input validation
            if (!body.creatorAddress) {
                return res.status(400).json({ 
                    error: 'Validation Error', 
                    message: 'creatorAddress is required' 
                })
            }

            if (!body.tokenName || !body.tokenSymbol) {
                return res.status(400).json({ 
                    error: 'Validation Error', 
                    message: 'tokenName and tokenSymbol are required' 
                })
            }

            // Sanitize inputs
            const sanitizedBody = {
                ...body,
                tokenName: body.tokenName.trim().substring(0, 100),
                tokenSymbol: body.tokenSymbol.trim().toUpperCase().substring(0, 10),
                tokenDescription: body.tokenDescription ? body.tokenDescription.trim().substring(0, 500) : '',
                creatorAddress: body.creatorAddress.trim(),
                network: body.network || 'ethereum'
            }

            if (!sanitizedBody.tokenAddress) {
                // Create new token request
                const request = await requestTable.create({
                    address: sanitizedBody.mintAddress ?? sanitizedBody.creatorAddress, 
                    body: JSON.stringify(sanitizedBody),
                })

                res.status(200).json({
                    success: true, 
                    sig: request.id,
                    message: 'Token creation request submitted'
                })
            } else {
                // Update existing token
                const token = await tokenTable.findOne({
                    where: {
                        tokenAddress: sanitizedBody.tokenAddress,
                        creatorAddress: sanitizedBody.creatorAddress
                    }
                })
                
                if (!token) {
                    return res.status(404).json({ 
                        error: 'Not Found', 
                        message: 'Token not found or you are not the creator' 
                    })
                }

                // Update allowed fields
                const updateFields = {}
                if (sanitizedBody.tokenBanner) updateFields.tokenBanner = sanitizedBody.tokenBanner
                if (sanitizedBody.telegramLink) updateFields.telegramLink = sanitizedBody.telegramLink
                if (sanitizedBody.twitterLink) updateFields.twitterLink = sanitizedBody.twitterLink
                if (sanitizedBody.webLink) updateFields.webLink = sanitizedBody.webLink

                await token.update(updateFields)
                
                res.status(200).json({
                    success: true,
                    message: 'Token updated successfully'
                })
            }
        } catch (error) {
            console.error('Error in createToken:', error)
            res.status(500).json({ 
                error: 'Internal Server Error', 
                message: error.message || 'An unexpected error occurred' 
            })
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
            const orderType = req.query.orderType || 'createdAt'
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
                        [Sequelize.literal('(EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM "updatedAt")) * 100 / 1800'), 'x']
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
                    tokenAddress, createdAt: { [Sequelize.Op.lt]: Sequelize.literal("NOW() - INTERVAL '15 minutes'") },
                },
                order: [['date', 'DESC']],
            })

            const trade1d = await tradeTable.findOne({
                attributes: [
                    [Sequelize.literal('SUM(CASE WHEN type=\'BUY\' THEN "ethAmount" ELSE -"ethAmount" END)'), 'liquidity']
                ],
                where: {
                    tokenAddress, createdAt: { [Sequelize.Op.gte]: Sequelize.literal("NOW() - INTERVAL '1 day'") }
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
        try {
            if (!req.file) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'No file uploaded.'
                });
            }

            // multer-s3 automatically uploads to S3 and adds file info to req.file
            console.log('File uploaded successfully to S3:', req.file);

            // Generate the correct Supabase public URL
            const publicUrl = getSupabasePublicUrl(req.file.key);

            res.status(200).json({
                success: true,
                message: 'File uploaded successfully to Supabase S3.',
                url: publicUrl, // Supabase public URL
                key: req.file.key, // S3 key/path
                file: {
                    originalname: req.file.originalname,
                    mimetype: req.file.mimetype,
                    size: req.file.size,
                    bucket: req.file.bucket,
                    etag: req.file.etag
                }
            });
        } catch (error) {
            console.error('Error uploading logo:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: error.message || 'Failed to upload file to Supabase S3.'
            });
        }
    }
}
