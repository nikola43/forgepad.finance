// const { WEBSOCKET_MSGTypes } = require("../config/websocket.config");
// const db = require("../models/index");
// const tokenTable = db.tokens;
// const tradeTable = db.trades;
// const holderTable = db.holders;
// const requestTable = db.requests;
// const usersTable = db.users;
// const createToken = async (io, data) => {
//     // From Frontend, we will get informations and save it to Database
//     try {
//         const newTokenInfo = {
//             tokenDescription: data.tokenDescription,
//             tokenName: data.tokenName,
//             tokenSymbol: data.tokenSymbol,
//             tokenAddress: data.tokenAddress,
//             tokenImage: data.tokenImage,
//             tokenBanner: data.tokenBanner,
//             marketcap: data.marketcap,
//             price: data.price,
//             virtualLP: data.virtualLP,
//             creatorAddress: data.creatorAddress,
//             network: data.network,
//             replies: data.replies,
//             creationTime: data.creationTime,
//             updateTime: data.updateTime,
//             webLink: data.webLink,
//             telegramLink: data.telegramLink,
//             twitterLink: data.twitterLink
//         }

//         if (data.launched)
//             newTokenInfo.launchedAt = Math.floor(Date.now() / 1000)

//         await tokenTable.create(newTokenInfo);

//         await requestTable.destroy({
//             where: {
//                 id: data.sig
//             }
//         })

//         const sendData = {
//             type: WEBSOCKET_MSGTypes.createToken,
//             data: data
//         }
//         io.emit('message', JSON.stringify(sendData)); // Emit to all clients
//     } catch (error) {
//         console.log(error);
//         const errorMsg = {
//             type: WEBSOCKET_MSGTypes.error,
//             data: "create a token error: " + error
//         }
//         io.emit('message', JSON.stringify(errorMsg));
//     }

// }
// const swap = async (io, data) => {
//     // From Frontend, we will get informations and save it to the database.
//     try {
//         // update token Price and marketcap in token table
//         const newTokenInfo = {
//             price: data.tokenPrice,
//             marketcap: data.marketcap,
//         }
//         if (data.launched)
//             newTokenInfo.launchedAt = Math.floor(Date.now() / 1000)

//         await tokenTable.update(newTokenInfo, {
//             where: { tokenAddress: data.tokenAddress, network: data.network },
//         });

//         // insert new trade row into trades table
//         const newTradeInfo = {
//             tokenName: data.tokenName,
//             tokenSymbol: data.tokenSymbol,
//             tokenAddress: data.tokenAddress,
//             tokenImage: data.tokenImage,
//             swapperAddress: data.swapperAddress,
//             type: data.type,
//             ethAmount: data.ethAmount,
//             tokenAmount: data.tokenAmount,
//             network: data.network,
//             txHash: data.txHash,
//             tokenPrice: data.tokenPrice,
//             date: Math.floor(Date.now() / 1000)
//         }

//         await tradeTable.create(newTradeInfo);
//         // create or update the holders table
//         const holderInfo = {
//             tokenName: data.tokenName,
//             tokenSymbol: data.tokenSymbol,
//             creatorAddress: data.creatorAddress,
//             tokenAddress: data.tokenAddress,
//             holderAddress: data.swapperAddress,
//             tokenAmount: data.tokenBalanceOfUser,
//             network: data.network,
//         }
//         // const result = await holderTable.upsert(holderInfo, {
//         //     where: { tokenAddress: data.tokenAddress.toString(), network: data.network.toString(), holderAddress: data.swapperAddress.toString()},
//         // });
//         const existingHolder = await holderTable.findOne({
//             where: {
//                 tokenAddress: data.tokenAddress,
//                 network: data.network,
//                 holderAddress: data.swapperAddress
//             }
//         });

//         if (existingHolder) {
//             // Record exists, update it
//             await existingHolder.update(holderInfo);
//         } else {
//             // Record does not exist, create it
//             await holderTable.create(holderInfo);
//         }

//         const sendData = {
//             type: WEBSOCKET_MSGTypes.swap,
//             data: data
//         }
//         io.emit('message', JSON.stringify(sendData)); // Emit to all clients
//     } catch (error) {
//         const errorMsg = {
//             type: WEBSOCKET_MSGTypes.error,
//             data: "swapError:" + error
//         }
//         io.emit('message', JSON.stringify(errorMsg));
//     }
// }

module.exports = io => {
    io.channels = {}
    io.exchanges = {}
    io.on('connection', (socket) => {
        console.log('New client connected', socket.id);

        // socket.on('TwitterLoginTry', (data) => {
        //     console.log(data)
        // })

        // socket.on('NewAddressConnected', (data) => {
        //     usersWalletsSockets[data.address] = data.socketID;
        //     console.log(data)
        // })
        // socket.on('TwitterLogin', async (data) => {
        //     console.log({
        //         dV: data
        //     })
        //     if (data.data?.address) {


        //         const user = await usersTable.findOne({
        //             where: {
        //                 address: data.data.address
        //             }
        //         });

        //         // console.log(user.dataValues)
        //         if (user) {
        //             await user.update({
        //                 address: data.data.address,
        //                 twitter_id: data.data.twitter_id,
        //                 twitter_username: data.data.twitter_username,
        //                 twitter_name: data.data.twitter_name,
        //                 twitter_profile_picture: data.data.twitter_profile_picture
        //             });
        //         }
        //     }
        // })

        // socket.on('message', async (message) => {
        //     const parsedData = JSON.parse(message);
        //     switch (parsedData.type) {
        //         case WEBSOCKET_MSGTypes.createToken:
        //             await createToken(io, parsedData.data);
        //             break;
        //         case WEBSOCKET_MSGTypes.swap:
        //             await swap(io, parsedData.data);
        //             break;
        //         default:
        //             break;
        //     }
        // });
        socket.on('SubAdd', ({ address, dex }) => {
            if(!!dex && dex!=="undefined") {
                io.channels[address] = (io.channels[address] ?? 0) + 1
                io.exchanges[address] = dex
            }
        })

        socket.on('SubRemove', ({ address }) => {
            if (io.channels[address] > 1)
                io.channels[address] = io.channels[address] - 1
            else
                delete io.channels[address]
        })

        socket.on('disconnect', () => {
            console.log('Client disconnected');
        });
    });
}