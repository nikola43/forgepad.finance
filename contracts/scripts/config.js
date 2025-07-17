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



    const address = "0x4f2580738917c4b2bF862994eC1c223d66857104"
    const Ethism = await ethers.getContractAt("EthismV2", address);
    await Ethism.emergencyWithdrawETH("81566623335059065")
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
