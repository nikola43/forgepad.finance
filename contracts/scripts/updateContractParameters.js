const { ethers, upgrades } = require("hardhat");
const config = require("../config");



async function main() {
    const [deployer] = await ethers.getSigners();

    const contractAddress = "0xb3233bB2089251973D126F733A9ad6216f29caa7"
    const fairLaunchFactory = await ethers.getContractAt("CoinHubLauncher", contractAddress, deployer);
    //const tx = await fairLaunchFactory.setTargetMarketCap("1")
    //console.log(tx)

    await fairLaunchFactory.setMaxSellPercent(300)

    // setTargetMarketCap
    // const tx = await fairLaunchFactory.setTargetMarketCap("69")

    // // setTargetLPAmount
    // const tx2 = await fairLaunchFactory.setTargetLPAmount("12")

    
}

// check_network();
main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
