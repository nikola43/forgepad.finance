const { ethers, upgrades } = require("hardhat");
const config = require("../config");



async function main() {
    const [deployer] = await ethers.getSigners();

    const contractAddress = "0xb3233bB2089251973D126F733A9ad6216f29caa7"
    const fairLaunchFactory = await ethers.getContractAt("CoinHubLauncherV8", contractAddress, deployer);
    const newToken = "0x3307cd692C052B5d721eFB542fB9862299D78B55"

    const pool = await fairLaunchFactory.tokenPools(newToken);
    console.log({
        pool
    })
    const firstBuyFee = await fairLaunchFactory.getFirstBuyFee(newToken);
    let value = eth_amount
    if (firstBuyFee > 0) {
        value = eth_amount.add(firstBuyFee);
    }

    await fairLaunch.connect(addr2).buyTokens(newToken, eth_amount, { value: value });
    const deployerTokenBalance = await token.balanceOf(deployer.address);
    console.log({
        deployerTokenBalance: ethers.utils.parseEther(deployerTokenBalance)
    })
    




}

// check_network();
main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
