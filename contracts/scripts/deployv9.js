const { ethers, upgrades } = require("hardhat");
const config = require("../config");
const { parseEther } = require("ethers/lib/utils");
const { verify } = require("./utils");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')
const fs = require("fs");


const FEE_PERCENT = 3;
const CREATE_TOKEN_FEE_AMOUNT = ethers.utils.parseEther("0");
const OWNER_FEE_PERCENT = 0;
const TARGET_MARKET_CAP = 36900;
const TARGET_LP_AMOUNT = 6400;
const TOTAL_SUPPLY = 10 ** 9; // 1 billion

async function main() {
    const router1 = "0xeB45a3c4aedd0F47F345fB4c8A1802BB5740d725" // 9inch mainnet
    const router2 = "0xcC73b59F8D7b7c532703bDfea2808a28a488cF47" // 9mm mainnet
    const router3 = "0x165C3410fC91EF562C50559f7d2289fEbed552d9" // pulseX mainnet
    const routers = [router1, router2, router3]
    const args = [
        routers,
        "0xefD766cCb38EaF1dfd701853BFCe31359239F305",
        CREATE_TOKEN_FEE_AMOUNT,
        FEE_PERCENT,
        OWNER_FEE_PERCENT,
        TARGET_MARKET_CAP,
        TARGET_LP_AMOUNT,
        TOTAL_SUPPLY
    ]

    fairLaunchV9 = await deployProxy("CoinHubLauncherV9_1", args)
    await fairLaunchV9.setPlatformBuyFeePercent(3)
    await fairLaunchV9.setPlatformSellFeePercent(3)
}

const updateABI = async (contractName) => {
    const abiDir = `${__dirname}/../abi`;
    if (!fs.existsSync(abiDir)) {
        fs.mkdirSync(abiDir);
    }
    const Artifact = artifacts.readArtifactSync(contractName);
    fs.writeFileSync(
        `${abiDir}/${contractName}.json`,
        JSON.stringify(Artifact.abi, null, 2)
    )
}

const deployProxy = async (contractName, args = [] = []) => {
    const factory = await ethers.getContractFactory(contractName)
    const contract = await upgrades.deployProxy(factory, args, {
        initializer: "initialize",
    })
    await contract.deployed()
    const implAddress = await getImplementationAddress(ethers.provider, contract.address);
    await updateABI(contractName)
    console.log({
        contractName, contract: contract.address, implAddress
    })

    return contract
}

main();
