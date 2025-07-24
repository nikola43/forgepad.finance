const { default: axios } = require("axios")
const { ethers, network } = require("hardhat")
const fs = require("fs")

const API_ENDPOINT = 'https://api.forgepad.finance'
const ETHISM_ADDRESS = '0xa348f2f1ac90350d587c0c1ef85b8bec3a066762'

async function main() {
    let [deployer] = await ethers.getSigners()

    // await network.provider.send("evm_mine")

    const { data: tokensInfo } = await axios.get(`${API_ENDPOINT}/tokens`, {
        params: {
            network: "base",
            pageSize: 100
        }
    })

    // const Ethism = await ethers.getContractFactory("EthismV2")
    // const ethism = await Ethism.deploy(
    //     '0x0000000000000000000000000000000000000001',
    //     '0x0000000000000000000000000000000000000002',
    //     '0x0000000000000000000000000000000000000003',
    //     '0x0000000000000000000000000000000000000004',
    //     69000,
    //     1000000000
    // )
    // await ethism.deployed()

    // deployer = await ethers.getImpersonatedSigner("0x0b0ac2ebb54ae5eb9977124953e1835a6ef7afa5");


    const ethism = await ethers.getContractAt("EthismV2", "0xa348f2f1ac90350d587c0c1ef85b8bec3a066762")
    const tokens = []
    for (const _token of tokensInfo.tokenList) {
        try {
            const { data: { holdersDetails } } = await axios.get(`${API_ENDPOINT}/tokens/${_token.network}/${_token.tokenAddress}`)
            const holders = holdersDetails.map(h => h.holderAddress)
            const tx = await ethism.migrateFrom(ETHISM_ADDRESS, _token.tokenAddress, holders)
            const { events } = await tx.wait()
            const event = events.find(e => e.event === 'Migrated')
            console.log(event)
            tokens.push([event.args.oldToken, event.args.newToken])
        } catch (e) {
            console.error(`Error processing token ${_token.tokenAddress}:`, e)
            continue
        }
    }
    fs.writeFileSync('migrate.sql', tokens.flatMap(([t1, t2]) => [
        `UPDATE holders SET tokenAddress="${t2}" WHERE tokenAddress="${t1}"`,
        `UPDATE trades SET tokenAddress="${t2}" WHERE tokenAddress="${t1}"`,
        `UPDATE tokens SET tokenAddress="${t2}" WHERE tokenAddress="${t1}"`,
    ]).join(";\n"))
}

main()