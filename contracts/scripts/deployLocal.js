const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const TARGET_MARKET_CAP = 60000;
const TOTAL_SUPPLY = 10 ** 9; // 1 billion

// BSC addresses (available on the fork)
const UNISWAP_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const UNISWAP_V3_POSITION_MANAGER = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364";
const UNISWAP_V4_POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b";
const UNISWAP_UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB";
const UNISWAP_V4_POSITION_MANAGER = "0x7c5f5a4bbd8fd63184577525326123b519429bdc";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const DATA_FEED = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE";

async function main() {
    const [owner] = await ethers.getSigners();
    console.log("Deploying with account:", owner.address);
    console.log("Account balance:", ethers.utils.formatEther(await owner.getBalance()), "BNB\n");

    const FEE_WALLET_ADDRESS = owner.address;
    const DISTRIBUTION_ADDRESS = owner.address;

    // 1. Deploy ForgepadLiquidityManager
    console.log("1/4 Deploying ForgepadLiquidityManager...");
    const LiquidityManagerFactory = await ethers.getContractFactory("ForgepadLiquidityManager");
    const liquidityManager = await LiquidityManagerFactory.deploy(
        UNISWAP_V2_ROUTER,
        UNISWAP_V3_POSITION_MANAGER,
        UNISWAP_V4_POOL_MANAGER,
        UNISWAP_UNIVERSAL_ROUTER,
        UNISWAP_V4_POSITION_MANAGER,
        PERMIT2,
        owner.address,  // marginRecipient
        owner.address,  // burnAddress
        10000,           // tokenAmountPercentToLP (100%)
        5000,            // ethAmountPercentToLP (50%)
        { gasLimit: 20000000 }
    );
    await liquidityManager.deployed();
    console.log("   ForgepadLiquidityManager:", liquidityManager.address);

    // 2. Deploy Forgepad
    console.log("2/4 Deploying Forgepad...");
    const ForgepadFactory = await ethers.getContractFactory("Forgepad");
    const forgepad = await ForgepadFactory.deploy(
        DATA_FEED,
        liquidityManager.address,
        FEE_WALLET_ADDRESS,
        DISTRIBUTION_ADDRESS,
        TARGET_MARKET_CAP,
        TOTAL_SUPPLY,
        { gasLimit: 20000000 }
    );
    await forgepad.deployed();
    console.log("   Forgepad:", forgepad.address);

    // 3. Authorize Forgepad as caller on LiquidityManager
    console.log("3/4 Setting authorized caller...");
    await liquidityManager.setAuthorizedCaller(forgepad.address, true);
    console.log("   Forgepad authorized on LiquidityManager");

    // 4. Configure fees
    console.log("4/4 Configuring fees...");
    await forgepad.setPlatformBuyFeePercent(3);
    await forgepad.setPlatformSellFeePercent(3);
    await forgepad.setMaxBuyPercent(300);
    await forgepad.setMaxSellPercent(300);
    console.log("   Buy/Sell fee: 3%, Max buy/sell: 3%\n");

    // Export ABI
    const abiDir = path.join(__dirname, '..', 'abi');
    if (!fs.existsSync(abiDir)) fs.mkdirSync(abiDir);

    const forgepadArtifact = artifacts.readArtifactSync("Forgepad");
    fs.writeFileSync(
        path.join(abiDir, 'Forgepad.json'),
        JSON.stringify(forgepadArtifact.abi, null, 2)
    );

    // Also copy ABI to backend listeners directory
    const backendAbiPath = path.join(__dirname, '..', '..', 'backend', 'app', 'listeners', 'EthismV1.json');
    fs.writeFileSync(backendAbiPath, JSON.stringify(forgepadArtifact.abi, null, 2));
    console.log("   ABI exported to backend/app/listeners/EthismV1.json");

    // Write deployment addresses to shared config
    const deployment = {
        network: 'localhost',
        chainId: 56,
        rpcUrl: 'http://127.0.0.1:8545',
        forgepad: forgepad.address,
        liquidityManager: liquidityManager.address,
        feeWallet: FEE_WALLET_ADDRESS,
        distributor: DISTRIBUTION_ADDRESS,
        dataFeed: DATA_FEED,
        targetMarketCap: TARGET_MARKET_CAP,
        totalSupply: TOTAL_SUPPLY,
        deployer: owner.address,
        timestamp: new Date().toISOString()
    };

    const deploymentPath = path.join(__dirname, '..', 'deployments', 'localhost.json');
    const deploymentsDir = path.dirname(deploymentPath);
    if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));

    console.log("=".repeat(50));
    console.log("DEPLOYMENT COMPLETE");
    console.log("=".repeat(50));
    console.log("Forgepad:              ", forgepad.address);
    console.log("LiquidityManager:      ", liquidityManager.address);
    console.log("Fee Wallet:            ", FEE_WALLET_ADDRESS);
    console.log("Target Market Cap:      $" + TARGET_MARKET_CAP);
    console.log("=".repeat(50));

    return deployment;
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
