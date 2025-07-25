// import {
//   time,
//   loadFixture,
// } from "@nomicfoundation/hardhat-toolbox/network-helpers";
// import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";
import { getImplementationAddress } from '@openzeppelin/upgrades-core';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const deployProxy = async (contractName, args = []) => {
  const factory = await ethers.getContractFactory(contractName)
  const contract = await upgrades.deployProxy(factory, args, {
    initializer: "initialize",
  })
  await contract.deployed()
  const implAddress = await getImplementationAddress(ethers.provider, contract.address);
  console.log({
    contractName, contract: contract.address, implAddress
  })
  return contract
}

// const TARGET_MARKET_CAP = 69000;
const TARGET_MARKET_CAP = 69000;
const TOTAL_SUPPLY = 10 ** 9; // 1 billion

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const UNISWAP_V3_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const UNISWAP_V4_POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const UNISWAP_UNIVERSAL_ROUTER = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af";
const UNISWAP_V4_POSITION_MANAGER = "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const FEE_WALLET_ADDRESS = "0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103"
const DISTRIBUTION_ADDRESS = "0xF2917a81fF74406fbCf01c507057e101Db8f2F12"
const DATA_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"

describe("Forgepad", function () {
  let EthismV2;
  let owner, addr1, addr2, addr3;
  let DAI;
  let token;
  let router;

  before(async () => {
    // await hre.network.provider.send("hardhat_setLoggingEnabled", [true]);

    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    // DAI = await ethers.getContractAt("Token", "0xdAC17F958D2ee523a2206206994597C13D831ec7");
    // router = await ethers.getContractAt("INineInchRouter02", "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D")

    console.log("owner address:", owner.address);


    // // sepolia
    // // const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
    // // const UNISWAP_V3_POSITION_MANAGER = "0x1238536071E1c677A632429e3655c799b22cDA52";
    // // const UNISWAP_V4_POOL_MANAGER = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
    // // const UNISWAP_UNIVERSAL_ROUTER = "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b";
    // // const UNISWAP_V4_POSITION_MANAGER = "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4";
    // // const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    // // const DISTRIBUTION_ADDRESS = "0xEb5aC7E48EF6cFFeFFC668Cbfb2F3f6763870269"
    // // const STABLE_COIN_ADDRESS = "0xD244aE11F2E55C382153ee958AD7A39F5Efb6559"; // DAI
    // // const DATA_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306"

    // const EthismLiquidityManagerArgs = [
    //   UNISWAP_V2_ROUTER,
    //   UNISWAP_V3_POSITION_MANAGER,
    //   UNISWAP_V4_POOL_MANAGER,
    //   UNISWAP_UNIVERSAL_ROUTER,
    //   UNISWAP_V4_POSITION_MANAGER,
    //   PERMIT2
    // ]

    // // Deploy only the fixed version
    // const EthismLiquidityManager = await deployProxy("EthismLiquidityManager", EthismLiquidityManagerArgs);

    // const args = [
    //   DATA_FEED,
    //   EthismLiquidityManager.address,
    //   FEE_WALLET_ADDRESS,
    //   DISTRIBUTION_ADDRESS,
    //   TARGET_MARKET_CAP,
    //   TOTAL_SUPPLY
    // ]

    // console.log("\n🚀 Deploying contracts...");

    // // Deploy only the fixed version
    // EthismV2 = await deployProxy("EthismV2", args); // Fixed contract

    // // Configure contract
    // await EthismV2.setPlatformBuyFeePercent(1);
    // await EthismV2.setPlatformSellFeePercent(1);
    // await EthismV2.setMaxSellPercent(300);
    // await EthismV2.setMaxBuyPercent(300);
    // await EthismV2.setTargetMarketCap(TARGET_MARKET_CAP);
    // await EthismV2.setFirstBuyFee(ethers.utils.parseEther("0"));
    // console.log("✅ Contract deployed and configured");


    // Base
    // const UNISWAP_V2_ROUTER = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
    // const UNISWAP_V3_POSITION_MANAGER = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
    // const UNISWAP_V4_POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b";
    // const UNISWAP_UNIVERSAL_ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b43";
    // const UNISWAP_V4_POSITION_MANAGER = "0x7c5f5a4bbd8fd63184577525326123b519429bdc";
    // const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    // const FEE_WALLET_ADDRESS = "0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103"
    // const DISTRIBUTION_ADDRESS = "0xF2917a81fF74406fbCf01c507057e101Db8f2F12"
    // const DATA_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"

    const EthismLiquidityManagerFactory = await ethers.getContractFactory("ForgepadLiquidityManager");
    const EthismLiquidityManager = await EthismLiquidityManagerFactory.deploy(
      UNISWAP_V2_ROUTER,
      UNISWAP_V3_POSITION_MANAGER,
      UNISWAP_V4_POOL_MANAGER,
      UNISWAP_UNIVERSAL_ROUTER,
      UNISWAP_V4_POSITION_MANAGER,
      PERMIT2,
      owner.address,
      owner.address, {
      gasLimit: 20000000, // Increase gas limit for deployment
    });
    await EthismLiquidityManager.deployed();

    await sleep(20000); // Wait for a second to ensure the contract is deployed
    console.log("EthismLiquidityManager deployed to:", EthismLiquidityManager.address);

    console.log("\n🚀 Deploying contracts...");

    const EthismV2Factory = await ethers.getContractFactory("Forgepad");
    EthismV2 = await EthismV2Factory.deploy(
      DATA_FEED,
      EthismLiquidityManager.address,
      FEE_WALLET_ADDRESS,
      DISTRIBUTION_ADDRESS,
      TARGET_MARKET_CAP,
      TOTAL_SUPPLY,
      {
        gasLimit: 20000000, // Increase gas limit for deployment
      }
    )
    await EthismV2.deployed();

    console.log("EthismV2 deployed to:", EthismV2.address);
  });

  describe("Tests", function () {
    it("1. Should create token", async function () {


      const getETHPriceByUSD = await EthismV2.getETHPriceByUSD();
      console.log("ETH Price in USD:", getETHPriceByUSD);

      const tx = await EthismV2.connect(owner).createToken(
        "Token", "FIXED", 0, 1, 1, { value: 0 }
      );
      const tx_result = await tx.wait();
      const evTokenCreated = tx_result.events.find(x => x.event == "TokenCreated");
      token = await ethers.getContractAt("Token", evTokenCreated.args.token);

      const tokenPool = await EthismV2.tokenPools(token.address);
      const marketCap = await EthismV2.getTokenMarketCap(token.address);
      const virtualMarketCap = await EthismV2.getTokenVirtualMarketCap(token.address);
      const ethPriceUSD = await EthismV2.getETHPriceByUSD();
      const tokenPrice = await EthismV2.getPrice(token.address);
      const vitualTokenPrice = await EthismV2.getVirtualPrice(token.address);
      const tokenPriceUSD = tokenPrice.mul(ethPriceUSD).div(ethers.utils.parseEther("1"));
      const virtualTokenPriceUSD = vitualTokenPrice.mul(ethPriceUSD).div(ethers.utils.parseEther("1"));

      console.log("pool owner:", tokenPool.owner);
      console.log("ETH Price in USD:", ethers.utils.formatEther(ethPriceUSD));
      console.log("Token Price:", ethers.utils.formatEther(tokenPrice));
      console.log("Virtual Token Price:", ethers.utils.formatEther(vitualTokenPrice));
      console.log("Token Price in USD:", ethers.utils.formatEther(tokenPriceUSD));
      console.log("Virtual Token Price in USD:", ethers.utils.formatEther(virtualTokenPriceUSD));
      console.log("Market Cap:", parseFloat(ethers.utils.formatEther(marketCap)));
      console.log("Virtual Market Cap:", parseFloat(ethers.utils.formatEther(virtualMarketCap)));

      console.log("Eth Reserve:", ethers.utils.formatEther(tokenPool.ethReserve));
      console.log("Token Reserve:", ethers.utils.formatEther(tokenPool.tokenReserve));
      console.log("Virtual Eth Reserve:", ethers.utils.formatEther(tokenPool.virtualEthReserve));
      console.log("Virtual Token Reserve:", ethers.utils.formatEther(tokenPool.virtualTokenReserve));
      console.log(" ")

      expect(evTokenCreated.args.token).to.be.properAddress;
    });

    it("2. Should buy", async function () {
      const firstFee = await EthismV2.getFirstBuyFee(token.address);
      console.log("First buy fee:", ethers.utils.formatEther(firstFee));
      const tradeSize = ethers.utils.parseEther("0.1");
      const tradeTx = await EthismV2.connect(addr1).swapExactETHForTokens(
        token.address, tradeSize, 0, { value: tradeSize.add(firstFee) }
      );
      const receipt = await tradeTx.wait();

      const tokenPool = await EthismV2.tokenPools(token.address);
      const marketCap = await EthismV2.getTokenMarketCap(token.address);
      const virtualMarketCap = await EthismV2.getTokenVirtualMarketCap(token.address);
      const ethPriceUSD = await EthismV2.getETHPriceByUSD();
      const tokenPrice = await EthismV2.getPrice(token.address);
      const vitualTokenPrice = await EthismV2.getVirtualPrice(token.address);
      const tokenPriceUSD = tokenPrice.mul(ethPriceUSD).div(ethers.utils.parseEther("1"));
      const virtualTokenPriceUSD = vitualTokenPrice.mul(ethPriceUSD).div(ethers.utils.parseEther("1"));
      const userBalance = await token.balanceOf(addr1.address);

      console.log("User balance after buy:", ethers.utils.formatEther(userBalance));

      console.log("ETH Price in USD:", ethers.utils.formatEther(ethPriceUSD));
      console.log("Token Price:", ethers.utils.formatEther(tokenPrice));
      console.log("Virtual Token Price:", ethers.utils.formatEther(vitualTokenPrice));
      console.log("Token Price in USD:", ethers.utils.formatEther(tokenPriceUSD));
      console.log("Virtual Token Price in USD:", ethers.utils.formatEther(virtualTokenPriceUSD));
      console.log("Market Cap:", parseFloat(ethers.utils.formatEther(marketCap)));
      console.log("Virtual Market Cap:", parseFloat(ethers.utils.formatEther(virtualMarketCap)));

      console.log("Eth Reserve:", ethers.utils.formatEther(tokenPool.ethReserve));
      console.log("Token Reserve:", ethers.utils.formatEther(tokenPool.tokenReserve));
      console.log("Virtual Eth Reserve:", ethers.utils.formatEther(tokenPool.virtualEthReserve));
      console.log("Virtual Token Reserve:", ethers.utils.formatEther(tokenPool.virtualTokenReserve));
      console.log(" ")
    });

    it("2. Should hit mc", async function () {

      let isLaunched = false;

      while (!isLaunched) {
        const firstFee = await EthismV2.getFirstBuyFee(token.address);
        console.log("First buy fee:", ethers.utils.formatEther(firstFee));
        const tradeSize = ethers.utils.parseEther("0.1");
        const tradeTx = await EthismV2.connect(addr2).swapExactETHForTokens(
          token.address, tradeSize, 0, { value: tradeSize.add(firstFee) }
        );
        const receipt = await tradeTx.wait();
        const evLaunched = receipt.events.find(e => e.event == "TokenLaunched");

        const tokenPool = await EthismV2.tokenPools(token.address);
        const marketCap = await EthismV2.getTokenMarketCap(token.address);
        const virtualMarketCap = await EthismV2.getTokenVirtualMarketCap(token.address);
        const ethPriceUSD = await EthismV2.getETHPriceByUSD();
        const tokenPrice = await EthismV2.getPrice(token.address);
        const vitualTokenPrice = await EthismV2.getVirtualPrice(token.address);
        const tokenPriceUSD = tokenPrice.mul(ethPriceUSD).div(ethers.utils.parseEther("1"));
        const virtualTokenPriceUSD = vitualTokenPrice.mul(ethPriceUSD).div(ethers.utils.parseEther("1"));

        console.log("ETH Price in USD:", ethers.utils.formatEther(ethPriceUSD));
        console.log("Token Price:", ethers.utils.formatEther(tokenPrice));
        console.log("Virtual Token Price:", ethers.utils.formatEther(vitualTokenPrice));
        console.log("Token Price in USD:", ethers.utils.formatEther(tokenPriceUSD));
        console.log("Virtual Token Price in USD:", ethers.utils.formatEther(virtualTokenPriceUSD));
        console.log("Market Cap:", parseFloat(ethers.utils.formatEther(marketCap)));
        console.log("Virtual Market Cap:", parseFloat(ethers.utils.formatEther(virtualMarketCap)));

        console.log("Eth Reserve:", ethers.utils.formatEther(tokenPool.ethReserve));
        console.log("Token Reserve:", ethers.utils.formatEther(tokenPool.tokenReserve));
        console.log("Virtual Eth Reserve:", ethers.utils.formatEther(tokenPool.virtualEthReserve));
        console.log("Virtual Token Reserve:", ethers.utils.formatEther(tokenPool.virtualTokenReserve));
        console.log(" ")

        if (evLaunched) {
          isLaunched = true;
          console.log("Token launched successfully!");


          // sell token from addr1
          const router1 = await ethers.getContractAt("INineInchRouter02", UNISWAP_V2_ROUTER);
          const wethAddress = await router1.WETH();
          const factory = await ethers.getContractAt("INineInchFactory", await router1.factory());
          const pairAddress = await factory.getPair(token.address, wethAddress);
          const pair = await ethers.getContractAt("IUniswapV2Pair", pairAddress);
          let [reserve0, reserve1] = await pair.getReserves();

          let token0 = await pair.token0();
          const tokenIsToken0 = token0.toLowerCase() === token.address.toLowerCase();

          const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
          const ethReserve = tokenIsToken0 ? reserve1 : reserve0;

          // Token price in ETH: how much ETH for 1 token
          const tokenPriceInPair = ethReserve.mul(ethers.utils.parseEther("1")).div(tokenReserve);

          // Get ETH price in USD
          const ethPriceUSD = await EthismV2.getETHPriceByUSD(); // should return a BigNumber with 18 decimals

          // Token price in USD = tokenPriceInPair (ETH) × ethPriceUSD (USD)
          const tokenPriceUSD = tokenPriceInPair.mul(ethPriceUSD).div(ethers.utils.parseEther("1"));

          // Get total token supply
          const totalSupply = await token.totalSupply(); // assume 18 decimals

          // Market Cap = tokenPriceUSD × totalSupply / 1e18
          const marketCapAfterMigration = tokenPriceUSD.mul(totalSupply).div(ethers.utils.parseEther("1"));

          console.log("Pair Address:", pairAddress);
          console.log("Token Price in ETH:", ethers.utils.formatEther(tokenPriceInPair));
          console.log("Token Price in USD:", ethers.utils.formatUnits(tokenPriceUSD, 18));
          console.log("Market Cap After Migration (USD):", ethers.utils.formatUnits(marketCapAfterMigration, 18));

          const addr1TokenBalance = await token.balanceOf(addr1.address);
          const ethBalanceBeforeSell = await ethers.provider.getBalance(addr1.address);
          const deadline = Math.floor(Date.now() / 1000) + 60 * 100; // 10 minutes from now

          const newTokenContract = await ethers.getContractAt("Token", token.address);
          await newTokenContract.connect(addr1).approve(router1.address, ethers.constants.MaxUint256);
          await router1.connect(addr1).swapExactTokensForETHSupportingFeeOnTransferTokens(
            addr1TokenBalance, 0, [token.address, wethAddress], addr1.address, deadline
          );

          [reserve0, reserve1] = await pair.getReserves();

          const tokenPriceInPairAfterSell = reserve1.mul(ethers.utils.parseEther("1")).div(reserve0);
          const ethBalanceAfterSell = await ethers.provider.getBalance(addr1.address);
          console.log("addr1 balance after sell:", ethers.utils.formatEther(ethBalanceAfterSell));
          console.log("addr1 token balance after sell:", ethers.utils.formatEther(await token.balanceOf(addr1.address)));
          console.log("Eth Balance Before Sell:", ethers.utils.formatEther(ethBalanceBeforeSell));
          console.log("Eth Balance After Sell:", ethers.utils.formatEther(ethBalanceAfterSell));
          console.log("Profit from Sell:", ethers.utils.formatEther(ethBalanceAfterSell.sub(ethBalanceBeforeSell)));
          console.log("Token Price in Pair After Sell:", ethers.utils.formatEther(tokenPriceInPairAfterSell));


          const addr1Balance = await ethers.provider.getBalance(addr1.address);
          console.log("addr1 balance after sell:", ethers.utils.formatEther(addr1Balance));


          break
        }
      }
    });
  });
});
