const { ethers, upgrades } = require("hardhat");
const config = require("../config");
const { parseEther } = require("ethers/lib/utils");
const { verify } = require("./utils");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')
const fs = require("fs");
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const TARGET_MARKET_CAP = 5000; // Reduced to $40K for more controlled testing
const TOTAL_SUPPLY = 10 ** 9; // 1 billion

// const routerV3 = "0x1238536071E1c677A632429e3655c799b22cDA52"
// const routerV2 = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3"
// const stableCoinAddress = "0xD244aE11F2E55C382153ee958AD7A39F5Efb6559"; // DAI

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // mainnet
    const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    const UNISWAP_V3_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
    const UNISWAP_V4_POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
    const UNISWAP_UNIVERSAL_ROUTER = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af";
    const UNISWAP_V4_POSITION_MANAGER = "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e";
    const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const FEE_WALLET_ADDRESS = "0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103"
    const DISTRIBUTION_ADDRESS = "0xF2917a81fF74406fbCf01c507057e101Db8f2F12"
    const DATA_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"

    // // sepolia
    // const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
    // const UNISWAP_V3_POSITION_MANAGER = "0x1238536071E1c677A632429e3655c799b22cDA52";
    // const UNISWAP_V4_POOL_MANAGER = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
    // const UNISWAP_UNIVERSAL_ROUTER = "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b";
    // const UNISWAP_V4_POSITION_MANAGER = "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4";
    // const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    // const DISTRIBUTION_ADDRESS = "0xEb5aC7E48EF6cFFeFFC668Cbfb2F3f6763870269"
    // const FEE_ADDRESS = "0x0DBBbB7aE5f27a247FC5bf15c2fa45a5aF13A84a"; // Distribution address
    // const DATA_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306"

    const EthismLiquidityManagerArgs = [
        UNISWAP_V2_ROUTER,
        UNISWAP_V3_POSITION_MANAGER,
        UNISWAP_V4_POOL_MANAGER,
        UNISWAP_UNIVERSAL_ROUTER,
        UNISWAP_V4_POSITION_MANAGER,
        PERMIT2
    ]

    // Deploy only the fixed version
    const EthismLiquidityManager = await deployProxy("EthismLiquidityManager", EthismLiquidityManagerArgs);
    await EthismLiquidityManager.deployed();

    await sleep(20000); // Wait for a second to ensure the contract is deployed

    const args = [
        DATA_FEED,
        EthismLiquidityManager.address,
        FEE_WALLET_ADDRESS,
        DISTRIBUTION_ADDRESS,
        TARGET_MARKET_CAP,
        TOTAL_SUPPLY
    ]

    console.log("\n🚀 Deploying contracts...");

    // Deploy only the fixed version
    EthismV2 = await deployProxy("EthismV2", args); // Fixed contract
    await sleep(20000); // Wait for a second to ensure the contract is deployed

    // Configure contract
    await EthismV2.setPlatformBuyFeePercent(1);
    await sleep(20000); // Wait for a second to ensure the contract is deployed
    await EthismV2.setPlatformSellFeePercent(1);
    await sleep(20000); // Wait for a second to ensure the contract is deployed
    await EthismV2.setMaxSellPercent(300);
    await sleep(20000); // Wait for a second to ensure the contract is deployed
    await EthismV2.setMaxBuyPercent(300);
    await sleep(20000); // Wait for a second to ensure the contract is deployed
    await EthismV2.setTargetMarketCap(TARGET_MARKET_CAP);
    await sleep(20000); // Wait for a second to ensure the contract is deployed
    await EthismV2.setFirstBuyFee(ethers.utils.parseEther("0"));
    await sleep(20000); // Wait for a second to ensure the contract is deployed
    console.log("✅ Contract deployed and configured");
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
    const initData = factory.interface.encodeFunctionData("initialize", args);

    await contract.deployed()
    const implAddress = await getImplementationAddress(ethers.provider, contract.address);
    await updateABI(contractName)
    console.log({
        contractName, contract: contract.address, implAddress
    })

    const estimate = await ethers.provider.estimateGas({
        data: factory.bytecode + initData.slice(2), // strip '0x' from initData
    });
    console.log(`Estimated deployment gas: ${estimate.toString()}`);



    return contract
}

main();
