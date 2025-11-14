const { ethers, upgrades } = require("hardhat");
const config = require("../config");
const { parseEther } = require("ethers/lib/utils");
const { verify } = require("./utils");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')
const fs = require("fs");
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const TARGET_MARKET_CAP = 60000; // Reduced to $69K for more controlled testing
const TOTAL_SUPPLY = 10 ** 9; // 1 billion

// const routerV3 = "0x1238536071E1c677A632429e3655c799b22cDA52"
// const routerV2 = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3"
// const stableCoinAddress = "0xD244aE11F2E55C382153ee958AD7A39F5Efb6559"; // DAI

async function main() {
    const [owner] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", owner.address);

    // // mainnet
    // const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    // const UNISWAP_V3_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
    // const UNISWAP_V4_POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
    // const UNISWAP_UNIVERSAL_ROUTER = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af";
    // const UNISWAP_V4_POSITION_MANAGER = "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e";
    // const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    // const FEE_WALLET_ADDRESS = "0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103"
    // const DISTRIBUTION_ADDRESS = "0xF2917a81fF74406fbCf01c507057e101Db8f2F12"
    // const DATA_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"

    // // Base
    // const UNISWAP_V2_ROUTER = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
    // const UNISWAP_V3_POSITION_MANAGER = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
    // const UNISWAP_V4_POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b";
    // const UNISWAP_UNIVERSAL_ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b43";
    // const UNISWAP_V4_POSITION_MANAGER = "0x7c5f5a4bbd8fd63184577525326123b519429bdc";
    // const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    // const FEE_WALLET_ADDRESS = "0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103"
    // const DISTRIBUTION_ADDRESS = "0xF2917a81fF74406fbCf01c507057e101Db8f2F12"
    // const DATA_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"

    // BSC
    const UNISWAP_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
    const UNISWAP_V3_POSITION_MANAGER = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364";
    const UNISWAP_V4_POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b";
    const UNISWAP_UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB";
    const UNISWAP_V4_POSITION_MANAGER = "0x7c5f5a4bbd8fd63184577525326123b519429bdc";
    const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const FEE_WALLET_ADDRESS = "0x2F259c6250257B035be590728e26e2c784E6D4EE"
    const DISTRIBUTION_ADDRESS = "0xC61878C192F205D4b75Dda925Ef55f9F338D4E09"
    const DATA_FEED = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE"
    const EthismLiquidityManagerFactory = await ethers.getContractFactory("ForgepadLiquidityManager");
    const EthismLiquidityManager = await EthismLiquidityManagerFactory.deploy(
        UNISWAP_V2_ROUTER,
        UNISWAP_V3_POSITION_MANAGER,
        UNISWAP_V4_POOL_MANAGER,
        UNISWAP_UNIVERSAL_ROUTER,
        UNISWAP_V4_POSITION_MANAGER,
        PERMIT2,
        owner.address,
        owner.address,
        10000, // 100% for testing
        5000, // 50% for testing 
        {
            gasLimit: 20000000, // Increase gas limit for deployment
        });
    await EthismLiquidityManager.deployed();

    // // await sleep(20000); // Wait for a second to ensure the contract is deployed
    console.log("EthismLiquidityManager deployed to:", EthismLiquidityManager.address);

    console.log("\n🚀 Deploying contracts...");

    const EthismV2Factory = await ethers.getContractFactory("Forgepad");
    const EthismV2 = await EthismV2Factory.deploy(
        DATA_FEED,
        EthismLiquidityManager.address,
        FEE_WALLET_ADDRESS,
        DISTRIBUTION_ADDRESS,
        TARGET_MARKET_CAP,
        TOTAL_SUPPLY,
        {
            gasLimit: 20000000, // Increase gas limit for deployment
        }
    )
    await EthismV2.deployed();

    console.log("EthismV2 deployed to:", EthismV2.address);

    // await verify(EthismV2.address, "EthismV2", [
    //     DATA_FEED,
    //     EthismLiquidityManager.address,
    //     FEE_WALLET_ADDRESS,
    //     DISTRIBUTION_ADDRESS,
    //     TARGET_MARKET_CAP,
    //     TOTAL_SUPPLY,
    // ]);

    // await verify(EthismLiquidityManager.address, "EthismLiquidityManager", [
    //     UNISWAP_V2_ROUTER,
    //     UNISWAP_V3_POSITION_MANAGER,
    //     UNISWAP_V4_POOL_MANAGER,
    //     UNISWAP_UNIVERSAL_ROUTER,
    //     UNISWAP_V4_POSITION_MANAGER,
    //     PERMIT2,
    //     deployer.address,
    //     deployer.address
    // ])
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


// export const verifyContract = async (contractAddress, contractName, args = []) => {
//     // @ts-ignore
//     if (network == 'localhost' || network == 'hardhat') return
//     try {
//         await updateABI(contractName)
//         await hre.run("verify:verify", {
//             address: contractAddress,
//             constructorArguments: args,
//         });
//     } catch (ex) {
//         console.log(ex);
//     }
// }

main();
