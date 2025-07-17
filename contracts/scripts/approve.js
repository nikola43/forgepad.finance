const { ethers, upgrades } = require("hardhat");
const config = require("../config");
const { parseEther } = require("ethers/lib/utils");
const { verify } = require("./utils");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')
const fs = require("fs");

async function main() {
    // token address
    const tokenAddress = "0xD244aE11F2E55C382153ee958AD7A39F5Efb6559"
    // contract address
    const contract = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3"

    // approve the contract to spend tokens on behalf of the user
    const token = await ethers.getContractAt("Token", tokenAddress);
    const tx = await token.approve(contract, parseEther("100000000000000000000000000"));
    await tx.wait();
    console.log(`Approved ${tokenAddress} to spend tokens on behalf of the user for contract ${contract}`);

    
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
