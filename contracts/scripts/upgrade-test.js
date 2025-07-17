const { ethers, upgrades } = require("hardhat");
const config = require("../config");
const { parseEther, formatEther } = require("ethers/lib/utils");
const { verify } = require("./utils");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')
const fs = require("fs");
const colors = require('colors/safe');

const FEE_PERCENT = 3;
const CREATE_TOKEN_FEE_AMOUNT = ethers.utils.parseEther("0");
const OWNER_FEE_PERCENT = 0;
const TARGET_MARKET_CAP = 36900;
const TARGET_LP_AMOUNT = 9700;
const TOTAL_SUPPLY = 10 ** 9; // 1 billion

async function main() {

    let [deployer] = await ethers.getSigners();
    if (deployer === undefined) throw new Error("Deployer is undefined.");
    console.log(
        colors.cyan("Deployer Address: ") + colors.yellow(deployer.address)
    );
    console.log(
        colors.cyan("Account balance: ") +
        colors.yellow(formatEther(await deployer.getBalance()))
    );
    console.log();

    const owner = "0x0be53d9FA63FD5817acd216c5B77514417D138FA"

    deployer = await ethers.getImpersonatedSigner(owner);

    // const contract = '0xb3233bB2089251973D126F733A9ad6216f29caa7'
    // const implAddress = '0x20106Fdf50D012171317090e3e7afAaeB6eee520'


    const coinHubLauncherAddress = "0xb3233bB2089251973D126F733A9ad6216f29caa7"
    const contractName = "CoinHubLauncherV9_1";
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

    let tx = await newContract.setPlatformBuyFeePercent(3)
    await tx.wait()
    tx = await newContract.setPlatformSellFeePercent(3)
    await tx.wait()
    tx = await newContract.setMaxSellPercent(300)
    await tx.wait()
    tx = await newContract.setMaxBuyPercent(300)
    await tx.wait()
    tx = await newContract.setTargetMarketCap(36900)
    await tx.wait()
    tx = await newContract.setTargetLPAmount(TARGET_LP_AMOUNT)
    await tx.wait()
    tx = await newContract.setTokenOwnerLPFee(ethers.utils.parseEther("10000000"))
    await tx.wait()
    tx = await newContract.setFirstBuyFee(ethers.utils.parseEther("3"))
    await tx.wait()
    tx = await newContract.setDesiredTokensForLP(ethers.utils.parseEther("260000000"))
    await tx.wait()
    tx = await newContract.setDesiredPLSForLP(ethers.utils.parseEther("210000000"))
    await tx.wait()
    tx = await newContract.pause()
    await tx.wait()



    const tokenCount = await newContract.tokenCount()
    const tokens = []
    const virtualEthReserves = []
    const newVirtualTokensReserves = []

    for (let i = 0; i < tokenCount; i++) {
        const tokenAddress = await newContract.tokenList(i)
        let tokenPool = await newContract.tokenPools(tokenAddress)
        // console.log("Token Pool: ", tokenPool)
        let token = await ethers.getContractAt("Token", tokenAddress, deployer);
        let symbol = await token.symbol()
        let tokenPrice = await newContract.getPrice(tokenAddress)
        let marketCap = await newContract.getTokenMarketCap(tokenAddress)
        let virtualEthReserve = await tokenPool.virtualEthReserve
        let virtualTokenReserve = await tokenPool.virtualTokenReserve
        let launched = await tokenPool.launched

        console.log({
            tokenAddress,
            symbol,
            tokenPrice: ethers.utils.formatEther(tokenPrice),
            marketCap: ethers.utils.formatEther(marketCap),
            virtualEthReserve: ethers.utils.formatEther(virtualEthReserve),
            virtualTokenReserve: ethers.utils.formatEther(virtualTokenReserve)
        })

        const currentVirtualTokenReserves = Number(ethers.utils.formatEther(virtualTokenReserve))
        console.log({
            currentVirtualTokenReserves
        })

        if (currentVirtualTokenReserves > 100000000 && !launched) {
            console.log("Updading token pool")
            const substractionAmount = ethers.utils.parseEther("100000000")            
            const _newVirtualTokensReserves = virtualTokenReserve.sub(substractionAmount)
            tokens.push(tokenAddress)
            virtualEthReserves.push(virtualEthReserve)
            newVirtualTokensReserves.push(_newVirtualTokensReserves)
        }
    }

    const tokensChunks = sliceIntoChunks(tokens, 200);
    const virtualEthReservesChunks = sliceIntoChunks(virtualEthReserves, 200);
    const newVirtualTokensReservesChunks = sliceIntoChunks(newVirtualTokensReserves, 200);

    for (let i = 0; i < tokensChunks.length; i++) {
        const tokensChunk = tokensChunks[i];
        const virtualEthReservesChunk = virtualEthReservesChunks[i];
        const newVirtualTokensReservesChunk = newVirtualTokensReservesChunks[i];

        // console.log({
        //     tokensChunk,
        //     virtualEthReservesChunk,
        //     newVirtualTokensReservesChunk
        // })

        const tx = await newContract.batchUpdateTokenPoolReserves(tokensChunk, virtualEthReservesChunk, newVirtualTokensReservesChunk)
        await tx.wait()
        console.log("Token Pools Updated", tx.hash)
    }
}


function sliceIntoChunks(arr, chunkSize) {
    const res = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        const chunk = arr.slice(i, i + chunkSize);
        res.push(chunk);
    }
    return res;
}


main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
