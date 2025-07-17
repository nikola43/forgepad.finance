const { default: axios } = require("axios")
const { ethers, network } = require("hardhat")

const Config = {
    API_ENDPOINT: 'https://api.forgepad.finance',
    MULTICALL_ADDRESS: '0xca11bde05977b3631167028862be2a173976ca11',
    "old": {
        ETHISM_ADDRESS: '0x034dE400A1adF5E215D75b04a095F10786687b9f'
    },
    "new": {
        ETHISM_ADDRESS: '0x07d15D57a3b0457677885C16E2bdF8653FC4e38b'
    }
}

async function main() {
    const [deployer] = await ethers.getSigners()

    await network.provider.send("evm_mine")

    const Multicall = await ethers.getContractFactory("Multicall3")
    const writer = await Multicall.deploy()
    const reader = await ethers.getContractAt("IMulticall3", writer.address)

    const oldEthism = await ethers.getContractAt("EthismV2", Config.old.ETHISM_ADDRESS)
    const newEthism = await ethers.getContractAt("EthismV2", Config.new.ETHISM_ADDRESS)
    const Token = await ethers.getContractFactory("Token")

    // const poolCount = await oldEthism.tokenCount()
    const { data: tokensInfo } = await axios.get(`${Config.API_ENDPOINT}/tokens`, {
        params: {
            network: "mainnet",
            pageSize: 100
        }
    })
    const tokens = []
    // const results = await reader.tryAggregate(false, tokensInfo.tokenList.map(_token => ({
    //     target: oldEthism.address,
    //     callData: oldEthism.interface.encodeFunctionData("tokenPools(address)", [_token.tokenAddress])
    // })))
    // console.log("results", results)
    const poolInfos = results.map(result => oldEthism.interface.decodeFunctionResult("tokenPools(address)", result.returnData))
    let i = 0
    for (const _token of tokensInfo.tokenList) {
        const callDatas = []
        let tokenAmount = ethers.utils.parseEther("1000000000")
        // const deploy = Token.getDeployTransaction(_token.tokenName, _token.tokenSymbol, tokenAmount)
        const token = await Token.deploy(_token.tokenName, _token.tokenSymbol, tokenAmount)
        await token.deployed()
        await token.transfer(writer.address, tokenAmount)
        await token.transferOwnership(writer.address)
        tokens.push([_token.tokenAddress, token.address])
        const { data: { holdersDetails } } = await axios.get(`${Config.API_ENDPOINT}/tokens/${_token.network}/${_token.tokenAddress}`)
        holdersDetails.forEach(holder => {
            const _tokenAmount = ethers.utils.parseEther(holder.tokenAmount)
            callDatas.push({
                target: token.address,
                callData: Token.interface.encodeFunctionData("transfer(address,uint256)", [holder.holderAddress, _tokenAmount])
            })
            tokenAmount = tokenAmount.sub(_tokenAmount)
        })
        const _ethReserve = poolInfos[i].ethReserve
        const _tokenReserve = poolInfos[i].tokenReserve
        callDatas.push({
            target: token.address,
            callData: Token.interface.encodeFunctionData("transfer(address,uint256)", [newEthism.address, _tokenReserve])
        }, {
            target: token.address,
            callData: Token.interface.encodeFunctionData("transferOwnership(address)", [newEthism.address])
        }, {
            target: newEthism.address,
            callDatas: newEthism.interface.encodeFunctionData("createPool(address,address,uint256,uint256,uint8,bool)", [token.address, _token.creatorAddress, _ethReserve, _tokenReserve, _token.poolType, token.launched])
        })
        await writer.aggregate(callDatas)
        i++
    }
    console.log("Query", tokens.flatMap(([t1, t2]) => [
        `UPDATE holders SET tokenAddress="${t2}" WHERE tokenAddress="${t1}"`,
        `UPDATE trades SET tokenAddress="${t2}" WHERE tokenAddress="${t1}"`,
        `UPDATE tokens SET tokenAddress="${t2}" WHERE tokenAddress="${t1}"`,
    ]).join(";\n"))
}

main()