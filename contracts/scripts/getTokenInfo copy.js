const { ethers, upgrades } = require("hardhat");
const config = require("../config");

const helpers = require("@nomicfoundation/hardhat-network-helpers");


async function main() {
    await helpers.mine()
    const [deployer] = await ethers.getSigners();
    const tokens = [
        "0x8a661f1070Da8C2BfED98ba6B2D24D2570c8Ffd7",
    ]

    const address = "0xb3233bB2089251973D126F733A9ad6216f29caa7"
    const fairLaunch = await ethers.getContractAt("CoinHubLauncherV8", address, deployer);
    const owner = await fairLaunch.owner();
    //console.log("Owner: ", owner)
    for (let i = 0; i < tokens.length; i++) {
        const tokenAddress = tokens[i]
        const tokenPool = await fairLaunch.tokenPools(tokenAddress)
        const token = await ethers.getContractAt("Token", tokens[i], deployer);
        const owner = await tokenPool.owner;
        const name = await token.name()
        const symbol = await token.symbol()
        const tokenPrice = await fairLaunch.getPrice(tokenAddress)
        //const virtualPrice = await fairLaunch.getVirtualPrice(tokenAddress)
        const marketCap = await fairLaunch.getTokenMarketCap(tokenAddress)
        //const virtualMarketCap = await fairLaunch.getVirtualTokenMarketCap(tokenAddress)

        console.log({
            tokenPool,
            owner,
            name,
            symbol,
            tokenAddress,
            tokenPrice: ethers.utils.formatUnits(tokenPrice, 18),
            //virtualPrice: ethers.utils.formatUnits(virtualPrice, 18),
            marketCap: ethers.utils.formatUnits(marketCap,18),
            //getVirtualTokenMarketCap: ethers.utils.formatUnits(virtualMarketCap,0)
        })
    }
}

// check_network();
main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
