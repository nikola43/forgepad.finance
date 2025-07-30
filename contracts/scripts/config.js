const { ethers, upgrades } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    const address = "0xBe246D0eBD173486B0b50961159eE053f753Df4f"
    const Ethism = await ethers.getContractAt("Forgepad", address);
    await(await Ethism.setPlatformBuyFeePercent("250")).wait();
    await(await Ethism.setPlatformSellFeePercent("250")).wait();

}

main().then(() => process.exit(0));
