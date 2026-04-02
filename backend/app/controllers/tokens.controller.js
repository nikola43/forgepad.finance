const { Buffer } = require("buffer");
// const bcrypt = require('bcrypt');
const Sequelize = require("sequelize");
// const jwt = require('jsonwebtoken');
const util = require('ethereumjs-util')
const dotenv = require('dotenv');

dotenv.config();

const db = require("../models/index");
const { CHAINS } = require("../config/web3.config");
const useLocalStorage = process.env.USE_LOCAL_STORAGE === 'true';
const isMySQL = process.env.DB_DIALECT === 'mysql';
const getSupabasePublicUrl = useLocalStorage ? null : require("../config/s3.config").getSupabasePublicUrl;
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

const VALID_NETWORKS = ['mainnet', 'base', 'bsc', 'solana'];
const WALLET_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Validate URL to prevent stored XSS (only allow http/https protocols)
function isValidUrl(str) {
    if (!str || typeof str !== 'string') return true; // empty is ok (optional field)
    try {
        const url = new URL(str);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
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

            // Validate wallet address format
            if (!WALLET_ADDRESS_REGEX.test(body.creatorAddress.trim())) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Invalid creatorAddress format'
                })
            }

            if (!body.tokenName || !body.tokenSymbol) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'tokenName and tokenSymbol are required'
                })
            }

            // Validate network against known networks
            const network = body.network || 'bsc';
            if (!VALID_NETWORKS.includes(network)) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid network. Must be one of: ${VALID_NETWORKS.join(', ')}`
                })
            }

            // Validate URL fields to prevent stored XSS
            const urlFields = {
                telegramLink: body.telegramLink,
                twitterLink: body.twitterLink,
                webLink: body.webLink
            };
            for (const [field, value] of Object.entries(urlFields)) {
                if (value && !isValidUrl(value)) {
                    return res.status(400).json({
                        error: 'Validation Error',
                        message: `Invalid URL for ${field}. Only http and https URLs are allowed.`
                    })
                }
            }

            // Sanitize inputs
            const sanitizedBody = {
                ...body,
                tokenName: body.tokenName.trim().substring(0, 100),
                tokenSymbol: body.tokenSymbol.trim().toUpperCase().substring(0, 10),
                tokenDescription: body.tokenDescription ? body.tokenDescription.trim().substring(0, 500) : '',
                creatorAddress: body.creatorAddress.trim(),
                network: network
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
                message: 'Failed to create token'
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
            console.error('Error in updateToken:', error);
            res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update token' });
        }
    },
    async getKing(req, res) {
        try {
            const tokenTable = db.tokens;
            const userTable = db.users;
            tokenTable.hasOne(userTable, { sourceKey: 'creatorAddress', foreignKey: 'address' })
            const king = await tokenTable.findOne({
                include: [{ model: userTable }],
                where: { category: 0 },
                order: [['marketcap', 'DESC']],
            });
            if (!king) {
                return res.status(404).json({ error: 'No king found' });
            }
            res.status(200).json(king);
        } catch (error) {
            console.error('Error in getKing:', error.message);
            res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch king' });
        }
    },
    async getAllTokens(req, res) {
        try {
            const orderType = req.query.orderType || 'createdAt'
            const orderFlag = req.query.orderFlag || 'DESC'
            const searchWord = req.query.searchWord
            const network = req.query.network
            const includeNSFW = req.query.includeNSFW == 'true';
            const pageNumber = req.query.pageNumber || 1;
            const pageSize = Number(req.query.pageSize) || 30;

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

            const tokenCount = await tokenTable.count({
                where,
            });
            const tokenList = await tokenTable.findAll({
                attributes: orderType === 'trends' || orderType === 'bump' ? {
                    include: [
                        [Sequelize.literal(isMySQL
                            ? '(UNIX_TIMESTAMP(NOW()) - UNIX_TIMESTAMP(`updatedAt`)) * 100 / 1800'
                            : '(EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM "updatedAt")) * 100 / 1800'
                        ), 'x']
                    ]
                } : {},
                where,
                order,
                limit: pageSize,
                offset,
            });

            res.status(200).json({ tokenList, tokenCount });
        } catch (error) {
            console.error('Error in getAllTokens:', error.message);
            res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch tokens' });
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
                    creatorAddress: userAddress,
                    ...(network && network !== "ALL" ? { network } : {})
                }
            });
            res.status(200).json(tokenList);
        } catch (error) {
            console.error('Error in myTokens:', error);
            res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch user tokens' });
        }
    },
    async getTokenDetails(req, res) {
        try {
            const { network, tokenAddress } = req.params;
            const { pageNumber = 1, pageSize = 10 } = req.query;

            const tokenDetils = await tokenTable.findOne({
                where: {
                    tokenAddress,
                    network
                }
            });

            if (!tokenDetils) {
                return res.status(404).json({ error: 'Not Found', message: 'Token not found' });
            }

            const trade15m = await tradeTable.findOne({
                attributes: [
                    'tokenPrice'
                ],
                where: {
                    tokenAddress, createdAt: { [Sequelize.Op.lt]: Sequelize.literal(isMySQL ? "NOW() - INTERVAL 15 MINUTE" : "NOW() - INTERVAL '15 minutes'") },
                },
                order: [['date', 'DESC']],
            })

            const trade1d = await tradeTable.findOne({
                attributes: [
                    [Sequelize.literal(isMySQL
                        ? "SUM(CASE WHEN type='BUY' THEN `ethAmount` ELSE -`ethAmount` END)"
                        : 'SUM(CASE WHEN type=\'BUY\' THEN "ethAmount" ELSE -"ethAmount" END)'
                    ), 'liquidity']
                ],
                where: {
                    tokenAddress, createdAt: { [Sequelize.Op.gte]: Sequelize.literal(isMySQL ? "NOW() - INTERVAL 1 DAY" : "NOW() - INTERVAL '1 day'") }
                }
            })

            const chain = CHAINS.find(chain => chain.network === network)
            const price15m = Number(tokenDetils.get('price')) - (trade15m ? Number(trade15m.get('tokenPrice')) : chain.virtualEthAmount / chain.virtualTokenAmount)
            tokenDetils.setDataValue('price15m', price15m.toFixed(12))
            tokenDetils.setDataValue('priceChange15m', (price15m * 100 / Number(tokenDetils.get('price'))).toFixed(2))
            if (trade1d) {
                tokenDetils.setDataValue('liquidity1d', trade1d.get('liquidity'))
            }

            const holdersDetails = await holderTable.findAll({
                where: {
                    tokenAddress: tokenAddress,
                    tokenAmount: { [Sequelize.Op.gt]: 0 },
                    network: network
                }
            });

            const tradesCount = await tradeTable.count({
                where: {
                    tokenAddress: tokenAddress,
                    network: network
                }
            })
            const trades = await tradeTable.findAll({
                where: {
                    tokenAddress: tokenAddress,
                    network: network
                },
                order: [['createdAt', 'DESC']],
                offset: (Number(pageNumber) - 1) * Number(pageSize),
                limit: Number(pageSize)
            });

            res.status(200).json({ tokenDetils, trades, tradesCount, holdersDetails });
        } catch (error) {
            console.error('Error in getTokenDetails:', error.message);
            res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch token details' });
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

            let publicUrl;
            if (useLocalStorage) {
                const localBaseUrl = process.env.LOCAL_FILE_URL || 'http://localhost/img';
                publicUrl = `${localBaseUrl}/${req.file.filename}`;
                console.log('File uploaded locally:', req.file.filename);
            } else {
                publicUrl = getSupabasePublicUrl(req.file.key);
                console.log('File uploaded to S3:', req.file.key);
            }

            res.status(200).json({
                success: true,
                message: 'File uploaded successfully.',
                url: publicUrl,
                key: useLocalStorage ? req.file.filename : req.file.key,
                file: {
                    originalname: req.file.originalname,
                    mimetype: req.file.mimetype,
                    size: req.file.size
                }
            });
        } catch (error) {
            console.error('Error uploading logo:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to upload logo'
            });
        }
    }
}
