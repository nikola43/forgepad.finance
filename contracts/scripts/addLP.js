const { ethers, upgrades } = require("hardhat");
const config = require("../config");
const { parseEther } = require("ethers/lib/utils");
const { verify } = require("./utils");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')
const fs = require("fs");

async function main() {
    const deployer = (await ethers.getSigners())[0];
    // token address
    const tokenAddress = "0xD244aE11F2E55C382153ee958AD7A39F5Efb6559"
    // contract address
    const contract = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3"
    const tokenDeployed = await ethers.getContractAt("Token", tokenAddress);
    const router = await ethers.getContractAt("IUniswapV2Router02", "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3");


    // await tokenDeployed.approve("0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3", ethers.constants.MaxUint256, { from: deployer?.address })
    const tx = await router.connect(deployer).addLiquidityETH(
        tokenAddress,
        parseEther("25000"),     // 25,000 tokens (1 ETH = 2.5k tokens)
        parseEther("0"),     // Min tokens to accept
        parseEther("0"),       // Min ETH to accept
        deployer?.address,
        Math.floor(Date.now() / 1000) + 60 * 20,  // 20 mins from now
        {
            value: parseEther("1"),   // 10 ETH
        }
    );
    console.log(`${colors.cyan('TX')}: ${colors.yellow(tx.hash)}`)
    console.log()

    // const routerFactory = await util.connectFactory();
    // const pairAddress = await routerFactory.getPair(util.chains.bsc.wChainCoin, tokenDeployed.address)
    // pairContract = await util.connectPair(pairAddress);
    // console.log(`${colors.cyan('LP Address')}: ${colors.yellow(pairContract?.address)}`)
    // console.log(`${colors.cyan('LP Balance')}: ${colors.yellow(formatEther(await pairContract.balanceOf(deployer?.address)))}`)
    // expect(1).to.be.eq(1);
    // console.log()



}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
