const { ethers, upgrades } = require("hardhat");
const config = require("../config");

const helpers = require("@nomicfoundation/hardhat-network-helpers");


async function main() {
    // await helpers.mine()
    const [deployer] = await ethers.getSigners();
    const tokens = [
        "0xd8e9D2924B022cc0054dd5E9F9bd0542a48187c9",
    ]

    const address = "0x391A58d604f8A51D97637194B4A0c32FCf42ECAf"
    const fairLaunch = await ethers.getContractAt("Forgepad", address, deployer);
    //console.log("Owner: ", owner)
    for (let i = 0; i < tokens.length; i++) {
        const tokenAddress = tokens[i]
        const tokenPool = await fairLaunch.tokenPools(tokenAddress)
        const token = await ethers.getContractAt("Token", tokens[i], deployer);
        const name = await token.name()
        const symbol = await token.symbol()
        const tokenPrice = await fairLaunch.getPrice(tokenAddress)
        //const virtualPrice = await fairLaunch.getVirtualPrice(tokenAddress)
        const marketCap = await fairLaunch.getTokenMarketCap(tokenAddress)
        const virtualMarketCap = await fairLaunch.getTokenVirtualMarketCap(tokenAddress)
        //const virtualMarketCap = await fairLaunch.getVirtualTokenMarketCap(tokenAddress)

        console.log({
            //tokenPool,
            launched : tokenPool.launched,
            ethReserve: ethers.utils.formatEther(tokenPool.ethReserve),
            tokenReserve: ethers.utils.formatEther(tokenPool.tokenReserve),
            name,
            symbol,
            tokenAddress,
            tokenPrice: ethers.utils.formatUnits(tokenPrice, 18),
            //virtualPrice: ethers.utils.formatUnits(virtualPrice, 18),
            marketCap: ethers.utils.formatEther(marketCap),
            virtualMarketCap: ethers.utils.formatEther(virtualMarketCap)
            //getVirtualTokenMarketCap: ethers.utils.formatUnits(virtualMarketCap,0)
        })
    }
}

// check_network();
main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
