const dotenv = require('dotenv');
dotenv.config();

const db = require("../models/index");
const chatTable = db.chats;
const tokenTable = db.tokens;
const util = require('ethereumjs-util')
const { Buffer } = require('node:buffer')

module.exports = {
    async getChatsByTokenAddress(req, res) {
        try {
            const { tokenAddress, network } = req.body;
            
            const msgList = await chatTable.findAll({
                where: {
                    tokenAddress: tokenAddress,
                    network: network
                },
                order: [
                    ['code', 'ASC'],
                    ['date', 'ASC']
                ]
            });

            res.status(200).json(msgList);
        } catch (error) {
            res.status(500).json({ error: 'Get Chats Error:', message: error });
        }
    },
    async replyByTokenAddress(req, res) {
        try {
            const { tokenAddress, replyAddress, comment, network, replyId, signature, msg } = req.body;
            if (!signature) 
                throw new Error("Need signature")
            const sig = util.fromRpcSig(signature);
            const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
            const prefixedMsg = util.keccak256(
                Buffer.concat([prefix, Buffer.from(String(msg.length)), Buffer.from(msg)])
            );

            const pubKey = util.ecrecover(prefixedMsg, sig.v, sig.r, sig.s);
            const addrBuf = util.pubToAddress(pubKey);
            const address = util.toChecksumAddress(util.bufferToHex(addrBuf));

            if(address!==replyAddress)
                throw new Error("Invalid address")

            const replyTo = replyId ? await chatTable.findOne({ 
                where: {
                    id: replyId
                }
            }) : undefined
            const newChatInfo = {
                tokenAddress: tokenAddress,
                replyAddress: replyAddress,
                comment: comment,
                network: network,
                code: `${replyTo ? `${replyTo.code}#` : ''}${Math.floor(Date.now() / 1000)}`
            }
            await chatTable.create(newChatInfo);
            const chatList = await chatTable.findAll({
                where: {
                    tokenAddress: tokenAddress,
                    network: network
                },
                order: [
                    ['code', 'ASC'],
                    ['date', 'ASC']
                ]
            });
            const token = await tokenTable.findOne({
                where: {
                    tokenAddress: tokenAddress,
                    network: network
                }
            })
            if(token) {
                token.replies ++
                token.save()
            }
            // await tokenTable.update(
            //     { replies: Sequelize.literal('replies + 1') }, // Increment the 'replies' field by 1
            //     {
            //         where: {
            //             tokenAddress: tokenAddress,
            //             network: network
            //         }
            //     }
            // );

            res.status(200).json(chatList);
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: 'Error', message: error });
        }
    },
}