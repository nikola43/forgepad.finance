const { ethers, upgrades } = require("hardhat");
const axios = require("axios");
const { formatEther, parseEther } = require("ethers/lib/utils");
const fs = require("fs");

const rankingApiEndpoint = "https://apipumpfork.9inch.io/users/ranking";
const ownerAddress = "0x0be53d9fa63fd5817acd216c5b77514417d138fa"
const percentageForGas = 0.0025; // 0.25%

async function main() {
    //if (impersonate) {
    // const deployer = await ethers.getImpersonatedSigner(ownerAddress);
    //}

    // const balance = await ethers.provider.getBalance(ownerAddress);
    //const balance = parseEther("800000000");
    //console.log(`Deployer balance: ${ethers.utils.formatEther(balance)} ETH`);

    const rankingData = await getRanking();
    const ownerBalance = parseEther("800000000");
    const totalRewards = Math.floor(Number(formatEther(ownerBalance)));
    const totalPoints = calculateTotalPoints(rankingData);
    const pointsToUsdValue = pointsToUsd(ownerBalance, totalPoints);
    const usersRewards = calculateUsersRewards(rankingData, totalRewards, totalPoints);
    console.log({
        usersRewards,
        ownerBalance,
        totalRewards,
        pointsToUsdValue,
        totalPoints,
    });
    fs.writeFileSync("usersRewards.json", JSON.stringify(usersRewards, null, 2));
    // const bulkTransfer = await ethers.getContractAt("BulkTransfer", bulkTransferAddress);

    
    
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
            wallet: ethers.utils.getAddress(user.address),
            amount: userRewards
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
