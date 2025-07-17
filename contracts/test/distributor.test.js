const { ethers, network } = require("hardhat")
const axios = require("axios")

const CHAINS = {
    sepolia: {
        UniversalRouter: "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b",
        Link: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
        UpkeepRegistry: "0x86EFBD0b6736Bed994962f9797049422A3A8E8Ad",
        UpkeepRegistrar: "0xb0E49c5D0d05cbc241d68c05BC5BA1d1B7B72976",
        VRFCoordinator: "0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B",
        VRFSubscriptionID: "87305210672197915779403738576896325327050272333082265185500143863408020064093",
        VRFKeyHash: "0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae",
        FunctionsRouter: "0xb83E47C2bC239B3bf370bc41e1459A34b41238D0",
        FunctionsSubscriptionID: "5256",
        FunctionsDonID: "0x66756e2d657468657265756d2d7365706f6c69612d3100000000000000000000"
    }
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

const main = async () => {
    const [owner] = await ethers.getSigners()
    // await network.provider.send('evm_mine')

    const chain = CHAINS['sepolia']
    const args = [
        chain.UniversalRouter,
        chain.Link,
        chain.UpkeepRegistry,
        chain.UpkeepRegistrar,
        chain.VRFCoordinator,
        chain.FunctionsRouter,
    ]
    const Distributor = await ethers.getContractFactory("contracts/Distributor.sol:Distributor")
    const distributor = await Distributor.deploy(...args)
    await distributor.deployed()
    console.log(distributor.address)

    const vrfCoordinator = await ethers.getContractAt(
        [ethers.utils.FunctionFragment.fromString("addConsumer(uint256,address)")],
        chain.VRFCoordinator
    )
    await vrfCoordinator.addConsumer(chain.VRFSubscriptionID, distributor.address)
    await distributor.assignVRF(
        chain.VRFSubscriptionID,
        chain.VRFKeyHash,
        0,
        1,
        0,
        false
    )

    const apiCoordinator = await ethers.getContractAt(
        [ethers.utils.FunctionFragment.fromString("addConsumer(uint64,address)")],
        chain.FunctionsRouter
    )
    await apiCoordinator.addConsumer(chain.FunctionsSubscriptionID, distributor.address)
    await distributor.assignAPI(
        'https://api.forgepad.finance/users/top/5',
        chain.FunctionsSubscriptionID,
        chain.FunctionsDonID,
        0
    )

    await distributor.startUpkeep(0, { value: ethers.utils.parseEther("0.005") })

    if (network.name != 'localhost') {
        await sleep(60000)
        await hre.run('verify:verify', {
            address: distributor.address,
            contract: 'contracts/Distributor.sol:Distributor',
            // referenceContract: "0x034de400a1adf5e215d75b04a095f10786687b9f",
            constructorArguments: args
        })
    }

    await owner.sendTransaction({
        to: distributor.address,
        value: ethers.utils.parseEther('0.1')
    })

    if (network.name == 'localhost') {
        owner.provider.on('block', (blockNumber) => {
            console.log('block', blockNumber)
            distributor.checkUpkeep('0x').then(([needed, data]) => {
                if (needed) {
                    console.log("perform", needed, data)
                    distributor.performUpkeep(data)
                }
            }).catch(() => { })
            owner.provider.getLogs({
                fromBlock: blockNumber,
                toBlock: blockNumber
            }).then(async logs => {
                for (const log of logs) {
                    if (log.topics[0] == '0xeb0e3652e0f44f417695e6e90f2f42c99b65cd7169074c5a654b16b9748c3a4e') {
                        // event RandomWordsRequested
                        const requestId = log.data.slice(0, 66)
                        console.log("VRF request", requestId)
                        await distributor.handleFullfillVRF(BigInt(requestId), BigInt(requestId))
                    } else if (log.topics[0] == '0xbf50768ccf13bd0110ca6d53a9c4f1f3271abdd4c24a56878863ed25b20598ff') {
                        // event OracleRequest
                        const requestId = log.topics[1]
                        console.log("API request", requestId)
                        const holders = new Array(10).fill(0).map(() => {
                            const w = ethers.Wallet.createRandom()
                            return w.address
                        })
                        const shares = new Array(10).fill(0x051EB851)
                        await distributor.handleFullfillAPI(BigInt(requestId), holders, shares)
                    }
                }
            })
        })
    }
}

main()