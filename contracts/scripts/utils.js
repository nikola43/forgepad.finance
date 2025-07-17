const fs = require('fs');

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

const verify = async (contractAddress, contractName, args = []) => {
    // @ts-ignore
    if (network == 'localhost' || network == 'hardhat') return
    try {
        await updateABI(contractName)
        await hre.run("verify:verify", {
            address: contractAddress,
            constructorArguments: args,
        });
    } catch (ex) {
        console.log(ex);
    }
}

exports.verify = verify;


