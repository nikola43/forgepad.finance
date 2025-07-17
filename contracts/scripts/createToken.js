const { ethers, upgrades } = require("hardhat");
const config = require("../config");



async function main() {
    const [deployer] = await ethers.getSigners();


    const add = "0xD0e5d570B64FC4af947211Aa0BE1ee81c275B86B"
    const fairLaunchV9 = await ethers.getContractAt("EthismV2", add, deployer);
    const buy_amount = ethers.utils.parseEther("0");
    const totalAmount = ethers.utils.parseEther("0");

    /*
            string memory name,
        string memory symbol,
        uint256 buyAmount,
        uint32 bitmapRouters,
        uint32 sig
    */

    const tx = await fairLaunchV9.createToken(
        "Token", "FIXED", 0, 1, 3, { value: 0 }
    );
    const tx_result = await tx.wait();
    console.log(tx.hash);
    const evTokenCreated = tx_result.events.find(x => x.event == "TokenCreated")
    console.log({
        args: evTokenCreated.args
    })
}

// check_network();
main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
