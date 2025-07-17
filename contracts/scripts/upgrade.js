const { ethers, upgrades } = require("hardhat");
const config = require("../config");
const { parseEther, formatEther } = require("ethers/lib/utils");
const { verify } = require("./utils");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')
const fs = require("fs");
const colors = require('colors/safe');



async function main() {

    const [deployer] = await ethers.getSigners();
    if (deployer === undefined) throw new Error("Deployer is undefined.");
    console.log(
        colors.cyan("Deployer Address: ") + colors.yellow(deployer.address)
    );
    console.log(
        colors.cyan("Account balance: ") +
        colors.yellow(formatEther(await deployer.getBalance()))
    );
    console.log();

    const coinHubLauncherAddress = "0xb3233bB2089251973D126F733A9ad6216f29caa7" 
    const contractName = "CoinHubLauncherV9_2";
    const factory = await ethers.getContractFactory(contractName, deployer);

    const newContract = (await upgrades.upgradeProxy(
        coinHubLauncherAddress,
        factory
    ))

    await newContract.deployed();
    console.log(
        `${colors.cyan("Contract Address")}: ${colors.yellow(
            newContract.address
        )}`
    );

    const implAddress = await getImplementationAddress(
        ethers.provider,
        newContract.address
    );

    console.log(
        `${colors.cyan("Implementation Address")}: ${colors.yellow(implAddress)}`
    );

}


main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
