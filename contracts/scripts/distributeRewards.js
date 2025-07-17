const { ethers, upgrades } = require("hardhat");
const axios = require("axios");
const { formatEther, parseEther } = require("ethers/lib/utils");
const fs = require("fs");

const rankingApiEndpoint = "https://apipumpfork.9inch.io/users/ranking";
const ownerAddress = "0x0be53d9fa63fd5817acd216c5b77514417d138fa"
const percentageForGas = 0.0025; // 0.25%
const bulkTransferAddress = "0xd5880436413133beA9c8588cdB592624A881Fbed"
const zeroAddress = ethers.constants.AddressZero;

async function main() {
    const [deployer] = await ethers.getSigners();
    // //if (impersonate) {
    // const deployer = await ethers.getImpersonatedSigner(ownerAddress);
    // //}

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`Deployer balance: ${ethers.utils.formatEther(balance)} ETH`);

    const rankingData = await getRanking();
    const ownerBalance = parseEther("800000000");
    const totalRewards = Math.floor(Number(formatEther(ownerBalance)));
    const totalPoints = calculateTotalPoints(rankingData);
    const pointsToUsdValue = pointsToUsd(ownerBalance, totalPoints);
    const usersRewards = calculateUsersRewards(rankingData, totalRewards, totalPoints);
    // console.log({
    //     usersRewards,
    //     ownerBalance,
    //     totalRewards,
    //     pointsToUsdValue,
    //     totalPoints,
    // });
    fs.writeFileSync("usersRewards.json", JSON.stringify(usersRewards, null, 2));
    const bulkTransfer = await ethers.getContractAt("BulkTransfer", bulkTransferAddress);

    const usersRewardsChunks = sliceIntoChunks(usersRewards, 200);
    for (let i = 0; i < usersRewardsChunks.length; i++) {
        const rewardsChunck = usersRewardsChunks[i];
        const users = rewardsChunck.map((r) => r.user);
        const rewardsAmounts = rewardsChunck.map((r) => ethers.utils.parseEther(r.rewards.toString()).toString())
        let totalAmount = 0;
        for (let i = 0; i < rewardsChunck.length; i++) {
            totalAmount += rewardsChunck[i].rewards;
        }
        let totalAmountInEth = ethers.utils.parseEther(totalAmount.toString());
        totalAmountInEth = totalAmountInEth.add(ethers.utils.parseEther("1"));
        console.log(formatEther(totalAmountInEth))
        // console.log({
        //   totalAmount,
        //   totalAmountInEth: totalAmountInEth.toString(),
        //   users,
        //   rewardsAmounts
        // })
        //fs.writeFileSync("rewards.json", JSON.stringify(rewards, null, 2));
        const tx = await bulkTransfer.connect(deployer).bulkTransfer(zeroAddress, users, rewardsAmounts, {
            value: totalAmountInEth.toString(),
            // gasLimit: ethers.utils.hexlify(2000000) // Set a higher gas limit
        });
        await tx.wait();
        console.log(`Bulk transfer ${i} done`, tx.hash)
        fs.writeFileSync(`bulkTransfer${i}.json`, JSON.stringify({
            users,
            rewardsAmounts,
            totalAmountInEth: formatEther(totalAmountInEth),
            txHash: tx.hash
        }, null, 2));

        // await bulkTransfer.withdraw()
    }
}

// const chunks = (array, size) => {
//     const results = [];
//     while (array.length) {
//         results.push(array.splice(0, size));
//     }
//     return results;
// };

function sliceIntoChunks(arr, chunkSize) {
    const res = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        const chunk = arr.slice(i, i + chunkSize);
        res.push(chunk);
    }
    return res;
}

function pointsToUsd(ownerBalance, totalPoints) {
    return ownerBalance / totalPoints;
}

function calculateUsersRewards(rankingData, totalRewards, totalPoints) {
    const rewards = [];
    for (let i = 0; i < rankingData.length; i++) {
        const user = rankingData[i];
        const userRewards = (user.ranking / totalPoints) * totalRewards;
        rewards.push({
            user: ethers.utils.getAddress(user.address),
            rewards: userRewards
        });
    }
    return rewards;
}

function calculateTotalPoints(rankingData) {
    let total = 0
    for (let i = 0; i < rankingData.length; i++) {
        total += Number(rankingData[i].ranking)
    }
    return Math.floor(total)
}

async function getRanking() {
    const resp = await axios.get(rankingApiEndpoint);
    const ranking = resp.data;
    return ranking;
}

async function getOwnerBalance() {
    const plsBalance = await ethers.provider.getBalance(ownerAddress);
    return Math.floor(Number(formatEther(plsBalance)));
}


main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
