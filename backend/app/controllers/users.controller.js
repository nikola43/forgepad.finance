//const { btoa } = require("buffer");
//const bcrypt = require('bcrypt');
const Sequelize = require("sequelize");
//const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const util = require('ethereumjs-util')
dotenv.config();
const { Buffer } = require('buffer');
//const axios = require("axios");
// const { twitterAuthClient, twitterClient, twitterState } = require('../config/twitter.config')

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
module.exports = {
    async getUserInfo(req, res) {
        try {
            const { userAddress } = req.query;
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
                // create user
                usersTable.create({
                    address: userAddress,
                    username,
                    bio,
                    avatar
                });
                res.status(200).json(user);
            }

            // check is has been elapsed 1 day since last update
            const now = new Date();
            const lastUpdate = new Date(user.updatedAt);
            const diff = now - lastUpdate;
            if (diff < 86400000) {
                res.status(403).json({ error: 'You can only update your profile once a day' });
                return;
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
            const { userAddress } = req.query.userAddress;
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
            res.status(200).json(user);
        } catch (error) {
            res.status(500).json({ error: 'Error', message: error });
        }
    },
    async getUserProfile(req, res) {
        try {
            const { address: userAddress } = req.params;
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
            // const users = await usersTable.findAll({
            //     attributes: ['username', 'address', [Sequelize.literal('CAST(RAND() * 10000000 AS UNSIGNED)'), 'ranking']],
            //     order: [
            //         [Sequelize.literal('ranking'), 'DESC']
            //     ],
            // });
            // const users = await db.sequelize.query(`
            //     SELECT users.username, users.avatar, t.address, SUM(t.points) AS ranking
            //     FROM (
            //         SELECT b.referee AS address, a.ethPrice * a.ethAmount AS points
            //         FROM trades AS a
            //             LEFT JOIN referrals AS b ON a.swapperAddress = b.referrer
            //         WHERE a.type = 'BUY' AND DATE(a.date) <= b.createdAt
            //         UNION ALL
            //         SELECT swapperAddress AS address, ethPrice * ethAmount AS points
            //         FROM trades
            //         WHERE type = 'BUY'
            //     ) AS t
            //         LEFT JOIN users ON t.address=users.address
            //     GROUP BY t.address
            //     ORDER BY ranking DESC
            // `, {
            //     type: Sequelize.QueryTypes.SELECT,
            // });


            const exploiters = [
                "0xEDD6174EC64de887807d1769f56351D0d1621B8d",
                "0xC9F149F221A347426BEE95a6640a73D8387c258C"
            ]

            // const users = await db.sequelize.query(`
            //     SELECT users.username, users.avatar, t.address, SUM(t.points) AS ranking
            //     FROM (
            //         SELECT b.referee AS address, a.ethPrice * a.ethAmount AS points
            //         FROM trades AS a
            //             INNER JOIN referrals AS b ON a.swapperAddress = b.referrer
            //         WHERE a.type = 'BUY' AND a.createdAt >= b.createdAt
            //         UNION ALL
            //         SELECT a.swapperAddress AS address, (a.ethPrice * a.ethAmount) * IF(b.id IS NULL, 10, 11) AS points
            //         FROM trades AS a
            //             LEFT JOIN referrals AS b ON a.swapperAddress = b.referrer AND a.createdAt >= b.createdAt
            //         WHERE a.type = 'BUY'
            //     ) AS t
            //         INNER JOIN users ON t.address=users.address
            //     GROUP BY t.address
            //     ORDER BY ranking DESC
            // `, {
            //     type: Sequelize.QueryTypes.SELECT,
            // });
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

            // divide by 10 for exploiters
            // for (let i = 0; i < users.length; i++) {
            //     users[i].rank = i;
            //     if (exploiters.includes(users[i].address)) {
            //         users[i].ranking /= 10;
            //     }
            // }
            users.forEach(user => {
                if (exploiters.includes(user.address)) {
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

            // console.log(users)
            res.status(200).json(users);
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
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
    // async loginWithTwitter(req, res) {
    //     const authUrl = twitterAuthClient.generateAuthURL({
    //         state: req.params.address,
    //         code_challenge_method: "s256",
    //     });
    //     console.log(authUrl);
    //     res.redirect(authUrl);
    // },

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

    async topHolders(req, res) {
        const { count } = req.params
        const { from = 0, to = Math.floor(Date.now() / 1000), index = 0, network } = req.query

        const holders = await tradesTable.findAll({
            where: {
                date: { [Sequelize.Op.gte]: from, [Sequelize.Op.lt]: to },
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
                holders.slice(Number(index) * Number(count), Number(index) * Number(count) + Number(count)).map(h => 
                    `${h.get('address').slice(2)}${BigInt(Math.floor(Number(h.get('volume')) * 0x100000000 / totalVolume)).toString(16).padStart(8, '0')}`
                ).join('')}`
        })
    }
}