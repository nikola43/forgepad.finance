const { ethers, upgrades } = require("hardhat");
const config = require("../config");
const { parseEther } = require("ethers/lib/utils");
const { verify } = require("./utils");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')
const fs = require("fs");



async function main() {
    const [deployer] = await ethers.getSigners();

    const automationRouter = "0xb83E47C2bC239B3bf370bc41e1459A34b41238D0"
    const vrfSubscriptionId = "78717793806841361217845026029365764654298163129688811391414916676012566800950"
    const vrfCoordinator = "0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B"
    const vrfKeyHash = "0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae"

    const EthismFeeDistributorFactory = await ethers.getContractFactory("EthismFeeDistributor");
    const ethismFeeDistributor = await EthismFeeDistributorFactory.deploy(
        automationRouter,
        vrfSubscriptionId,
        vrfCoordinator,
        vrfKeyHash)
    await ethismFeeDistributor.deployed();
    console.log(`\n🚀 EthismFeeDistributor deployed to: ${ethismFeeDistributor.address}`);


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


main();
