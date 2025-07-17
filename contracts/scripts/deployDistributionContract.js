const { ethers, upgrades } = require("hardhat");
async function main() {
    let [deployer] = await ethers.getSigners();
    
    const contractName = "BulkTransferETH"
    const factory = await ethers.getContractFactory(contractName)
    const contract = await factory.deploy()
    await contract.deployed()
    console.log("BulkTransferETH deployed to:", contract.address);
}

main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
