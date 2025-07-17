const { ethers, upgrades } = require("hardhat");
const config = require("../config");



async function main() {
    const [deployer] = await ethers.getSigners();

    const contractAddress = "0x2d6262C9bC59cd14Bf1965332d1F6C78567041f1"
    const token = await ethers.getContractAt("Token", contractAddress, deployer);
    const launched = await token.launched()
    console.log(launched)

    
}

// check_network();
main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
