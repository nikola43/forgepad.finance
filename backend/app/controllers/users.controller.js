const Sequelize = require("sequelize");
const dotenv = require('dotenv');
const util = require('ethereumjs-util')
dotenv.config();
const { Buffer } = require('buffer');

const db = require("../models/index");
const usersTable = db.users;
const tradesTable = db.trades;
const chatsTable = db.chats;
const holdersTable = db.holders;
const tokenTable = db.tokens;
const followersTable = db.followers;
const followeesTable = db.followees;
const referralInfoTable = db.referralInfo;
const referralsTable = db.referrals;
const adminTable = db.admins;

// Wallet address validation
const WALLET_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
function isValidAddress(address) {
    return typeof address === 'string' && WALLET_ADDRESS_REGEX.test(address);
}

// Simple in-memory rate limiter for addLike
const likeCooldowns = new Map();
const LIKE_COOLDOWN_MS = 60 * 1000; // 1 minute cooldown per address

module.exports = {
    async getUserInfo(req, res) {
        try {
            const { userAddress } = req.query;
            if (!isValidAddress(userAddress)) {
                return res.status(400).json({ error: 'Invalid wallet address format' });
            }
            usersTable.hasOne(adminTable, { sourceKey: 'address', foreignKey: 'address' })
            const user = await usersTable.findOne({
                include: [{
                    model: adminTable
                }],
                where: {
                    address: userAddress
                }
            });

            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            res.status(200).json(user);
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async createUser(req, res) {
        try {
            const { user: userInfo, signature, msg, refCode } = req.body

            const sig = util.fromRpcSig(signature);
            const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
            const prefixedMsg = util.keccak256(
                Buffer.concat([prefix, Buffer.from(String(msg.length)), Buffer.from(msg)])
            );

            const pubKey = util.ecrecover(prefixedMsg, sig.v, sig.r, sig.s);
            const addrBuf = util.pubToAddress(pubKey);
            const userAddress = util.toChecksumAddress(util.bufferToHex(addrBuf));

            const { username, bio, avatar } = userInfo;
            let user = await usersTable.findOne({
                where: {
                    address: userAddress
                }
            });

            if (user) {
                res.status(409).json({ error: 'User already exists' });
                return;
            }

            user = await usersTable.create({
                address: userAddress,
                username,
                bio,
                avatar
            });

            // create referral info for new user
            const userReferralInfo = {
                address: userAddress,
                referral_code: userAddress.slice(8, 16),
            }
            await referralInfoTable.create(userReferralInfo);

            // if user has referral code, add referral
            if (refCode) {
                const referralInfo = await referralInfoTable.findOne({
                    where: {
                        referral_code: refCode
                    }
                });

                if (referralInfo) {
                    if (referralInfo.address != userAddress) {

                        // check if user has already been referred by same referrer
                        const referral = await referralsTable.findOne({
                            where: {
                                referrer: userAddress,
                                referee: referralInfo.address
                            }
                        });

                        if (!referral) {
                            // add referral
                            await referralsTable.create({
                                referrer: userAddress,
                                referee: referralInfo.address
                            });
                        }
                    }
                }
            }

            res.status(200).json(user);
        } catch (error) {
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async updateUsername(req, res) {
        try {
            const { user: userInfo, signature, msg } = req.body
            const sig = util.fromRpcSig(signature);
            const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
            const prefixedMsg = util.keccak256(
                Buffer.concat([prefix, Buffer.from(String(msg.length)), Buffer.from(msg)])
            );

            const pubKey = util.ecrecover(prefixedMsg, sig.v, sig.r, sig.s);
            const addrBuf = util.pubToAddress(pubKey);
            const userAddress = util.toChecksumAddress(util.bufferToHex(addrBuf));
            const { username, bio, avatar } = userInfo;
            const user = await usersTable.findOne({
                where: {
                    address: userAddress
                }
            });

            if (!user) {
                // create user if they don't exist yet
                const newUser = await usersTable.create({
                    address: userAddress,
                    username,
                    bio,
                    avatar
                });
                return res.status(200).json(newUser);
            }

            // check if 1 day has elapsed since last update
            const now = new Date();
            const lastUpdate = new Date(user.updatedAt);
            const diff = now.getTime() - lastUpdate.getTime();
            if (diff < 86400000) {
                return res.status(403).json({ error: 'You can only update your profile once a day' });
            }

            user.username = username;
            user.bio = bio;
            user.avatar = avatar;
            await user.save();
            res.status(200).json(user);
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async addLike(req, res) {
        try {
            const userAddress = req.query.userAddress;
            if (!isValidAddress(userAddress)) {
                return res.status(400).json({ error: 'Invalid wallet address format' });
            }

            // Rate limit: one like per address per minute
            const now = Date.now();
            const lastLike = likeCooldowns.get(userAddress);
            if (lastLike && (now - lastLike) < LIKE_COOLDOWN_MS) {
                return res.status(429).json({ error: 'Too many requests. Please wait before liking again.' });
            }

            const user = await usersTable.findOne({
                where: {
                    address: userAddress
                }
            });

            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            user.likes += 1;
            await user.save();
            likeCooldowns.set(userAddress, now);
            res.status(200).json(user);
        } catch (error) {
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async getUserProfile(req, res) {
        try {
            const { address: userAddress } = req.params;
            if (!isValidAddress(userAddress)) {
                return res.status(400).json({ error: 'Invalid wallet address format' });
            }
            chatsTable.hasOne(usersTable, { sourceKey: 'replyAddress', foreignKey: 'address' })
            const replies = await chatsTable.findAll({
                include: [{
                    model: usersTable
                }],
                where: {
                    replyAddress: userAddress
                },
                order: [
                    ['date', 'DESC']
                ],
                limit: 100
            });
            holdersTable.hasOne(tokenTable, { sourceKey: 'tokenAddress', foreignKey: 'tokenAddress' })
            const helds = await holdersTable.findAll({
                attributes: ['id', 'tokenAddress', 'tokenAmount'],
                include: [{
                    model: tokenTable
                }],
                where: {
                    holderAddress: userAddress,
                    tokenAmount: {
                        [Sequelize.Op.gt]: 0
                    }
                }
            })
            tokenTable.hasOne(usersTable, { sourceKey: 'creatorAddress', foreignKey: 'address' })
            const tokens = await tokenTable.findAll({
                include: [{
                    model: usersTable,
                }],
                where: {
                    creatorAddress: userAddress
                },
                order: [
                    ['creationTime', 'DESC']
                ],
                // limit: 100
            });
            followersTable.hasOne(followeesTable, { sourceKey: 'followerId', foreignKey: 'id' })
            followersTable.hasOne(usersTable, { sourceKey: 'followerId', foreignKey: 'address' })
            const followers = await followersTable.findAll({
                attributes: ['followerId'],
                include: [{
                    model: followeesTable,
                    attributes: ['followers'],
                }, {
                    model: usersTable,
                }],
                where: {
                    followeeId: userAddress
                },
                order: [
                    ['followedAt', 'DESC']
                ],
            });
            followersTable.hasOne(followeesTable, { sourceKey: 'followeeId', foreignKey: 'id' })
            followersTable.hasOne(usersTable, { sourceKey: 'followeeId', foreignKey: 'address' })
            const followees = await followersTable.findAll({
                attributes: ['followeeId'],
                include: [{
                    model: followeesTable,
                    attributes: ['followers'],
                }, {
                    model: usersTable,
                }],
                where: {
                    followerId: userAddress
                },
                order: [
                    ['followedAt', 'DESC']
                ],
            });

            const referrals = await referralsTable.count({
                where: {
                    referee: userAddress
                }
            })

            const referred = await referralsTable.findAll({
                where: {
                    referrer: userAddress
                }
            })

            let referredUsername = "";

            // get referred username
            if (referred.length > 0) {
                referredUsername = await usersTable.findAll({
                    attributes: ['username'],
                    where: {
                        address: referred[0].referee
                    }
                })
            }

            // const { earnings } = await referralInfoTable.findOne({
            //     attributes: ['earnings'],
            //     where: {
            //         address: userAddress
            //     }
            // })

            const points = await db.sequelize.query(`
                SELECT SUM(points) AS total, SUM(IF(type=1, points, NULL)) AS earnings
                FROM (
                    SELECT 1 AS type, SUM(a.ethPrice * a.ethAmount) AS points
                    FROM referrals AS b
                        INNER JOIN trades AS a ON a.swapperAddress = b.referrer
                    WHERE a.type = 'BUY' AND a.createdAt >= b.createdAt AND b.referee=?
                    UNION
                    SELECT 2 AS type, SUM(a.ethPrice * a.ethAmount) * IF(b.id IS NULL, 10, 11) AS points
                    FROM trades AS a
                        LEFT JOIN referrals AS b ON a.swapperAddress = b.referrer AND a.createdAt >= b.createdAt
                    WHERE a.type = 'BUY' AND a.swapperAddress=?
                ) t
            `, {
                type: Sequelize.QueryTypes.SELECT,
                replacements: [userAddress, userAddress]
            });

            res.status(200).json({
                helds, replies, tokens, followers, followees, referrals, points: points?.[0], referredUsername
            });
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async getRanking(req, res) {
        try {
            // Fetch penalized addresses from the admins table (addresses flagged for score reduction)
            const penalizedAdmins = await adminTable.findAll({
                attributes: ['address'],
                where: {
                    penalized: true
                },
                raw: true
            }).catch(() => []);
            const penalizedAddresses = penalizedAdmins.map(a => a.address);

            let users = await db.sequelize.query(`
                SELECT users.username, users.avatar, t.address, SUM(t.points) AS ranking
                FROM (
                    SELECT b.referee AS address, a.ethPrice * a.ethAmount AS points
                    FROM trades AS a
                        INNER JOIN referrals AS b ON a.swapperAddress = b.referrer
                    WHERE a.type = 'BUY' AND a.createdAt >= b.createdAt AND a.createdAt >= STR_TO_DATE('2024-10-29 20:00:00', '%Y-%m-%d %H:%i:%s')
                    UNION ALL
                    SELECT a.swapperAddress AS address, (a.ethPrice * a.ethAmount) * IF(b.id IS NULL, 10, 11) AS points
                    FROM trades AS a
                        LEFT JOIN referrals AS b ON a.swapperAddress = b.referrer AND a.createdAt >= b.createdAt
                    WHERE a.type = 'BUY' AND a.createdAt >= STR_TO_DATE('2024-10-29 20:00:00', '%Y-%m-%d %H:%i:%s')
                    UNION ALL
                    SELECT b.referee AS address, -(a.ethPrice * a.ethAmount * 4) AS points
                    FROM trades AS a
                        INNER JOIN referrals AS b ON a.swapperAddress = b.referrer
                    WHERE a.type = 'SELL' AND a.createdAt >= b.createdAt AND a.createdAt >= STR_TO_DATE('2024-10-29 20:00:00', '%Y-%m-%d %H:%i:%s')
                    UNION ALL
                    SELECT a.swapperAddress AS address, -(a.ethPrice * a.ethAmount * 4) AS points
                    FROM trades AS a
                        LEFT JOIN referrals AS b ON a.swapperAddress = b.referrer AND a.createdAt >= b.createdAt
                    WHERE a.type = 'SELL' AND a.createdAt >= STR_TO_DATE('2024-10-29 20:00:00', '%Y-%m-%d %H:%i:%s')
                ) AS t
                    INNER JOIN users ON t.address = users.address
                GROUP BY t.address
                ORDER BY ranking DESC;
            `, {
                type: Sequelize.QueryTypes.SELECT,
            });

            // Penalize flagged addresses by reducing their ranking score
            users.forEach(user => {
                if (penalizedAddresses.includes(user.address)) {
                    user.ranking /= 10;
                }
            });

            // sort by ranking
            users.sort((a, b) => b.ranking - a.ranking);

            for (let i = 0; i < users.length; i++) {
                users[i].rank = i;
            }

            // remove users with negative ranking
            users = users.filter(user => user.ranking > 0);

            res.status(200).json(users);
        } catch (error) {
            console.error('Error in getRanking:', error.message);
            res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch rankings' });
        }
    },
    async getBalance(req, res) {
        try {
            const { id } = req.params;
            holdersTable.hasOne(tokenTable, { sourceKey: 'tokenAddress', foreignKey: 'tokenAddress' })
            const data = await holdersTable.findByPk(id, {
                attributes: ['id', 'tokenAddress', 'tokenAmount'],
                include: [{
                    model: tokenTable
                }]
            })
            res.status(200).json(data);
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async getFollowings(req, res) {
        try {
            const { address: userAddress } = req.params;
            if (!isValidAddress(userAddress)) {
                return res.status(400).json({ error: 'Invalid wallet address format' });
            }
            followersTable.hasOne(followeesTable, { sourceKey: 'followeeId', foreignKey: 'id' })
            followersTable.hasOne(usersTable, { sourceKey: 'followeeId', foreignKey: 'address' })
            const followees = await followersTable.findAll({
                attributes: ['followeeId'],
                include: [{
                    model: followeesTable,
                    attributes: ['followers'],
                }, {
                    model: usersTable,
                }],
                where: {
                    followerId: userAddress
                },
                order: [
                    ['followedAt', 'DESC']
                ],
            });

            res.status(200).json(followees);
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async followUser(req, res) {
        try {
            const { address: followeeId } = req.params
            const { msg, signature } = req.body

            const sig = util.fromRpcSig(signature);
            const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
            const prefixedMsg = util.keccak256(
                Buffer.concat([prefix, Buffer.from(String(msg.length)), Buffer.from(msg)])
            );

            const pubKey = util.ecrecover(prefixedMsg, sig.v, sig.r, sig.s);
            const addrBuf = util.pubToAddress(pubKey);
            const followerId = util.toChecksumAddress(util.bufferToHex(addrBuf));
            await followersTable.upsert({
                followerId, followeeId
            })
            await followeesTable.upsert({
                id: followeeId, followers: 1
            }, { followers: Sequelize.literal('followers + 1') })
            res.status(200).json({
                success: true
            });
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async unfollowUser(req, res) {
        try {
            const { address: followeeId } = req.params
            const { msg, signature } = req.body

            const sig = util.fromRpcSig(signature);
            const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
            const prefixedMsg = util.keccak256(
                Buffer.concat([prefix, Buffer.from(String(msg.length)), Buffer.from(msg)])
            );

            const pubKey = util.ecrecover(prefixedMsg, sig.v, sig.r, sig.s);
            const addrBuf = util.pubToAddress(pubKey);
            const followerId = util.toChecksumAddress(util.bufferToHex(addrBuf));
            await followersTable.destroy({
                where: {
                    followerId, followeeId
                }
            })
            await followeesTable.update({
                followers: Sequelize.literal('followers - 1')
            }, {
                where: {
                    id: followeeId
                }
            })
            res.status(200).json({
                success: true
            });
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async addRefferal(req, res) {
        const { refCode, address } = req.params;

        const referralInfo = await referralInfoTable.findOne({
            where: {
                referral_code: refCode
            }
        });

        if (!referralInfo) {
            res.status(404).json({ error: 'Referral code not found' });
            return;
        }

        // check if user is referring himself
        if (referralInfo.address === address) {
            res.status(403).json({ error: 'You cannot refer yourself' });
            return;
        }
    },

    async uploadAvatar(req, res) {
        try {
            const { signature, msg } = req.body
            if (!signature || !msg) {
                return res.status(400).json({ error: 'Signature and message are required' });
            }
            const sig = util.fromRpcSig(signature);
            const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
            const prefixedMsg = util.keccak256(
                Buffer.concat([prefix, Buffer.from(String(msg.length)), Buffer.from(msg)])
            );
            const pubKey = util.ecrecover(prefixedMsg, sig.v, sig.r, sig.s);
            const addrBuf = util.pubToAddress(pubKey);
            const userAddress = util.toChecksumAddress(util.bufferToHex(addrBuf));

            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            const useLocalStorage = process.env.USE_LOCAL_STORAGE === 'true';
            const avatarKey = useLocalStorage ? req.file.filename : req.file.key;

            let user = await usersTable.findOne({ where: { address: userAddress } });
            if (!user) {
                user = await usersTable.create({
                    address: userAddress,
                    username: '',
                    bio: '',
                    avatar: avatarKey
                });
            } else {
                user.avatar = avatarKey;
                await user.save();
            }
            res.status(200).json({ avatar: avatarKey, user });
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error.message });
        }
    },

    async topHolders(req, res) {
        const { count } = req.params
        const { from = 0, to = Math.floor(Date.now() / 1000), index = 0, network } = req.query

        // Validate numeric inputs
        const safeCount = Math.min(Math.max(parseInt(count) || 10, 1), 50);
        const safeFrom = parseInt(from) || 0;
        const safeTo = parseInt(to) || Math.floor(Date.now() / 1000);
        const safeIndex = parseInt(index) || 0;

        // Validate network if provided (only allow known values)
        const VALID_NETWORKS = ['mainnet', 'base', 'bsc', 'solana'];
        if (network && !VALID_NETWORKS.includes(network)) {
            return res.status(400).json({ error: 'Invalid network parameter' });
        }

        const holders = await tradesTable.findAll({
            where: {
                date: { [Sequelize.Op.gte]: safeFrom, [Sequelize.Op.lt]: safeTo },
                ...( network ? { network } : undefined )
            },
            attributes: [
                ['swapperAddress', 'address'],
                [Sequelize.literal('SUM(tokenAmount * tokenPrice * ethPrice)'), 'volume']
            ],
            order: [
                ['volume', 'DESC']
            ],
            group: [
                'swapperAddress'
            ],
            limit: 50
        })

        const totalVolume = holders.reduce((sum, holder) => sum + Number(holder.get('volume')), 0)

        res.json({
            bytes: `${
                holders.slice(safeIndex * safeCount, safeIndex * safeCount + safeCount).map(h =>
                    `${h.get('address').slice(2)}${BigInt(Math.floor(Number(h.get('volume')) * 0x100000000 / totalVolume)).toString(16).padStart(8, '0')}`
                ).join('')}`
        })
    }
}