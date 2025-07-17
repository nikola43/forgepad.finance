const { ethers, upgrades } = require("hardhat");
const config = require("../config");



async function main() {


    const [deployer] = await ethers.getSigners();

    const coinLauncherAddress = "0xF2086d67F744Ad3C274743538EF3F67DF709B112"
    const tokenAddress = "0x2b333E374c2DA8A93cd628A871241263773B358C"
    const tokenContract = await ethers.getContractAt("Token", tokenAddress, deployer);

    const amount = ethers.utils.parseEther("1");
    const tx = await tokenContract.transferFrom(coinLauncherAddress, deployer.address, ethers.utils.parseEther("1"));
    console.log(`tx: ${tx.hash}`);
}

// check_network();
main();
