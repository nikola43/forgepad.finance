const { ethers, upgrades } = require('hardhat')
const config = require("../config");



async function main() {
    const [deployer] = await ethers.getSigners();

    const contractAddress = "0xb3233bB2089251973D126F733A9ad6216f29caa7"
    const implementation = "0x39C98573EF5Bc9DF269D97bc2ea7657aED2dFb03"

    const contract = await forceImport(contractAddress, implementation, {
        kind: 'transparent'
    })
}

export async function forceImport(
    contractAddress: string,
    deployedImpl: any,
    opts: {
        kind?: 'uups' | 'transparent' | 'beacon'
    }
) {
    const contract = await upgrades.forceImport(
        contractAddress,
        deployedImpl,
        opts
    )

    return contract
}

// check_network();
main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
