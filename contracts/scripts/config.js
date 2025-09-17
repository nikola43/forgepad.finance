const { ethers, upgrades } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    const address = "0xcff81F0B6f8a9eC58e566f0D45C0654bDc6e82e8"
    const Ethism = await ethers.getContractAt("Forgepad", address);
    await(await Ethism.emergencyWithdrawETH("167000000000000000")).wait();

}

main().then(() => process.exit(0));
