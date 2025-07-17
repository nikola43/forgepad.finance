const { ethers } = require("hardhat");
const { expect } = require("chai");
const config = require("../config.json");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')
const fs = require("fs");
const FEE_PERCENT = 3;
const CREATE_TOKEN_FEE_AMOUNT = ethers.utils.parseEther("0");
const OWNER_FEE_PERCENT = 0;
const TARGET_MARKET_CAP = 69000;
const TARGET_LP_AMOUNT = 12000;
// const TARGET_MARKET_CAP = 69;
// const TARGET_LP_AMOUNT = 12;
//const TOTAL_SUPPLY = 10 ** 9; // 1 billion
const TOTAL_SUPPLY = 10 ** 9; // 1 billion

// PLS TESTNET
//const UNISWAP_ROUTER_ADDRESS = config["0x3AF"].router;
//const USDT_ADDRESS = config["0x3AF"].usdc;

// PLS MAINNET
// const USDT_ADDRESS = config["0x171"].usdc;
let routers = []
let DAI

let newToken;
let newTokenContract;
let fairLaunch
let totalInvested = ethers.utils.parseEther("0");

let owner, addr1, addr2, addr3, addr4, addrBurn, addrTreasury, addrs

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

const deployProxy = async (contractName, args = [] = []) => {
  const factory = await ethers.getContractFactory(contractName)
  const contract = await upgrades.deployProxy(factory, args, {
    initializer: "initialize",
  })
  await contract.deployed()
  const implAddress = await getImplementationAddress(ethers.provider, contract.address);
  await updateABI(contractName)
  console.log({
    contractName, contract: contract.address, implAddress
  })
  return contract
}

describe("Fair Launch", async () => {
  before(async () => {
    [owner, addr1, addr2, addr3, addr4, addrBurn, addrTreasury, ...addrs] = await ethers.getSigners();
    //const daiFactory = await ethers.getContractFactory("FakeToken")
    DAI = await ethers.getContractAt("Token", "0xefD766cCb38EaF1dfd701853BFCe31359239F305");
    //const routerFactory = await ethers.getContractFactory("FakeRouter")
    const router1 = await ethers.getContractAt("INineInchRouter02", "0xeB45a3c4aedd0F47F345fB4c8A1802BB5740d725")
    // await router1.addLiquidityETH(
    //   DAI.address, 
    //   ethers.utils.parseUnits('25.462614', 6),
    //   0,
    //   0,
    //   owner.address,
    //   Math.floor(Date.now() / 1000) + 100,
    //   { value: ethers.utils.parseEther('564573.58294966') }
    // )
    // const router2 = await routerFactory.deploy()
    // const router3 = await routerFactory.deploy()
    // const router1 = "0xeB45a3c4aedd0F47F345fB4c8A1802BB5740d725" // 9inch mainnet
    // const router2 = "0xcC73b59F8D7b7c532703bDfea2808a28a488cF47" // 9mm mainnet
    // const router3 = "0x165C3410fC91EF562C50559f7d2289fEbed552d9" // pulseX mainnet
    routers = [router1.address]
    // //routers = [router1]
    const args = [
      routers,
      "0xefD766cCb38EaF1dfd701853BFCe31359239F305", // DAI 
      CREATE_TOKEN_FEE_AMOUNT,
      FEE_PERCENT,
      OWNER_FEE_PERCENT,
      TARGET_MARKET_CAP,
      TARGET_LP_AMOUNT,
      TOTAL_SUPPLY
    ]

    fairLaunch = await deployProxy("CoinHubLauncherV8", args)
  });

  describe("Functions", async () => {
    it("Should create token", async () => {

      //addr1 = await ethers.getImpersonatedSigner("0x930409e3c77ba9e6d2F6C95Ac16b64E273bc95C6");

      const token_count = await fairLaunch.tokenCount();
      const buy_amount = ethers.utils.parseEther("0")
      const buy_fee = buy_amount.gt(0) ? await fairLaunch.getFirstBuyFee(ethers.constants.AddressZero) : buy_amount
      const totalAmount = buy_amount.add(CREATE_TOKEN_FEE_AMOUNT).add(buy_fee);
      const tx = await fairLaunch.connect(addr1).createToken("TestName", "TestSymbol", buy_amount, 0x1, 1, { value: totalAmount });
      const tx_result = await tx.wait();
      newToken = tx_result.events.filter(x => x.event == "TokenCreated")[0].args[0];
      newTokenContract = await ethers.getContractAt("Token", newToken);

      expect(newToken).to.equal(await fairLaunch.tokenList(token_count));
      expect(await fairLaunch.tokenCount()).to.equal(token_count + 1);

      const pool = await fairLaunch.tokenPools(newToken);
      const ethReserve = ethers.utils.formatEther(pool.ethReserve);
      const virtualEthReserve = ethers.utils.formatEther(pool.virtualEthReserve);
      const tokenReserve = ethers.utils.formatEther(pool.tokenReserve);
      const virtualTokenReserve = ethers.utils.formatEther(pool.virtualTokenReserve);
      const marketCap = await fairLaunch.getTokenMarketCap(newToken);
      const virtualMarketCap = await fairLaunch.getVirtualTokenMarketCap(newToken);
      const price = await fairLaunch.getPrice(newToken);
      const virtualPrice = await fairLaunch.getVirtualPrice(newToken);
      const launched = pool.launched;
      const token = pool.token;
      const owner = pool.owner;
      const totalSupply = ethers.utils.formatEther(await newTokenContract.totalSupply());
      const contractTokenBalance = await newTokenContract.balanceOf(fairLaunch.address);
      const contractEthBalance = await ethers.provider.getBalance(fairLaunch.address);
      const ethPriceByUSD = await fairLaunch.getETHPriceByUSD();

      console.log("New Token Address: ", newToken);
      console.log("Fair Contract Address: ", fairLaunch.address);

      console.log("Token Price: ", ethers.utils.formatEther(price));
      console.log("Virtual Price: ", ethers.utils.formatEther(virtualPrice));
      console.log("EthReserve: ", ethReserve);
      console.log("Virtual eth reserve: ", virtualEthReserve);
      console.log("TokenReserve: ", tokenReserve);
      console.log("Virtual token reserve: ", virtualTokenReserve);
      console.log("TokenMarketCap: ", ethers.utils.formatUnits(marketCap, 0));
      console.log("Virtual MarketCap: ", ethers.utils.formatUnits(virtualMarketCap, 0));
      console.log("Launched: ", launched);
      // console.log("token: ", token);
      // console.log("owner: ", owner);
      console.log("Total Supply: ", totalSupply);
      console.log("Contract Token Balance: ", ethers.utils.formatEther(contractTokenBalance));
      console.log("Contract ETH Balance: ", ethers.utils.formatEther(contractEthBalance));
      console.log("ETH Price: ", ethers.utils.formatEther(ethPriceByUSD));
    });

    it("Buy Token", async () => {
   
      let eth_amount = ethers.utils.parseEther("1000000");
      

      for (let i = 0; i < 2000; i++) {
        const pool = await fairLaunch.tokenPools(newToken);
        const firstBuyFee = await fairLaunch.getFirstBuyFee(newToken);
        let value = eth_amount
        if (firstBuyFee > 0) {
          value = eth_amount.add(firstBuyFee);
        }
        totalInvested = totalInvested.add(eth_amount);

        if (!pool.launched) {
          await fairLaunch.connect(addr2).buyTokens(newToken, eth_amount, { value: value });
        }


        const addr2TokenBalance = await newTokenContract.balanceOf(addr2.address);

        const ethReserve = ethers.utils.formatEther(pool.ethReserve);
        const virtualEthReserve = ethers.utils.formatEther(pool.virtualEthReserve);
        const tokenReserve = ethers.utils.formatEther(pool.tokenReserve);
        const virtualTokenReserve = ethers.utils.formatEther(pool.virtualTokenReserve);
        const marketCap = await fairLaunch.getTokenMarketCap(newToken);
        const virtualMarketCap = await fairLaunch.getVirtualTokenMarketCap(newToken);
        const price = await fairLaunch.getPrice(newToken);
        const virtualPrice = await fairLaunch.getVirtualPrice(newToken);
        const launched = pool.launched;
        const token = pool.token;
        const owner = pool.owner;
        const totalSupply = ethers.utils.formatEther(await newTokenContract.totalSupply());
        const contractTokenBalance = await newTokenContract.balanceOf(fairLaunch.address);
        const contractEthBalance = await ethers.provider.getBalance(fairLaunch.address);
        const ethPriceByUSD = await fairLaunch.getETHPriceByUSD();

        // console.log("New Token Address: ", newToken);
        // console.log("Fair Contract Address: ", fairLaunch.address);

        // console.log("User Token Balance: ", ethers.utils.formatEther(addr2TokenBalance));
        // console.log("Token Price: ", ethers.utils.formatEther(price));
        // console.log("Virtual Price: ", ethers.utils.formatEther(virtualPrice));
        // console.log("Eth Reserve: ", ethReserve);
        // console.log("Virtual eth reserve: ", virtualEthReserve);
        // console.log("Token Reserve: ", tokenReserve);
        // console.log("Virtual token reserve: ", virtualTokenReserve);
        // console.log("TokenMarketCap: ", ethers.utils.formatUnits(marketCap, 0));
        // console.log("Virtual MarketCap: ", ethers.utils.formatUnits(virtualMarketCap, 0));
        // console.log("Launched: ", launched);
        // // console.log("token: ", token);
        // // console.log("owner: ", owner);
        // // console.log("Total Supply: ", totalSupply);
        // console.log("Contract Token Balance: ", ethers.utils.formatEther(contractTokenBalance));
        // console.log("Contract ETH Balance: ", ethers.utils.formatEther(contractEthBalance));
        // //console.log("ETH Price: ", ethers.utils.formatEther(ethPriceByUSD));
        // console.log("Total Invested: ", ethers.utils.formatEther(totalInvested));




        // const pool = await fairLaunch.tokenPools(newToken);
        // const ethReserve = ethers.utils.formatEther(pool.ethReserve);
        // const tokenReserve = ethers.utils.formatEther(pool.tokenReserve);
        // const launched = pool.launched;
        // const token = pool.token;
        // const owner = pool.owner;
        // const totalSupply = ethers.utils.formatEther(await newTokenContract.totalSupply());

        // tokenPrice = await fairLaunch.getPrice(newToken);
        // contractTokenBalance = await newTokenContract.balanceOf(fairLaunch.address);
        // contractEthBalance = await ethers.provider.getBalance(fairLaunch.address);
        // ethPriceByUSD = await fairLaunch.getETHPriceByUSD();
        // marketCap = await fairLaunch.getTokenMarketCap(newToken);
        // console.log("New Token Address: ", newToken);
        // console.log("Fair Contract Address: ", fairLaunch.address);
        // console.log("ethReserve: ", ethReserve);
        // console.log("tokenReserve: ", tokenReserve);
        // console.log("launched: ", launched);
        // console.log("token: ", token);
        // console.log("owner: ", owner);
        // console.log("Total Supply: ", totalSupply);
        // console.log("Token Price: ", ethers.utils.formatEther(tokenPrice));
        // console.log("Contract Token Balance After: ", ethers.utils.formatEther(contractTokenBalance));
        // console.log("Contract ETH Balance After: ", ethers.utils.formatEther(contractEthBalance));
        // console.log("ETH Price: ", ethers.utils.formatEther(ethPriceByUSD));
        // console.log("TokenMarketCap: ", ethers.utils.formatUnits(marketCap, 0));

        console.log('===============================', launched ? 'end' : (i + 1), '======================================')
        if (launched)
          break

      }
    });


  });
});
