const { ethers, network } = require("hardhat");
const { expect } = require("chai");
const config = require("../config.json");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')
const fs = require("fs");
const FEE_PERCENT = 3;
const CREATE_TOKEN_FEE_AMOUNT = ethers.utils.parseEther("0");
const OWNER_FEE_PERCENT = 0;
const TARGET_MARKET_CAP = 36900;
const TARGET_LP_AMOUNT = 6400;
const TOTAL_SUPPLY = 10 ** 9; // 1 billion

let routers = []
let DAI

let tokenV8, tokenV9;
let fairLaunchV8, fairLaunchV9
let totalInvested = ethers.utils.parseEther("0");

let owner, addr1, addr2, addr3, addr4, addrBurn, addrTreasury, addrs

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

const upgradeProxy = async (contractName, originAddress, args = []) => {
  const factory = await ethers.getContractFactory(contractName)
  const newContract = (await upgrades.upgradeProxy(
    originAddress,
    factory,
    // {
    //   call: "upgrade", args
    // }
  ))
  await newContract.deployed()
  const implAddress = await getImplementationAddress(ethers.provider, newContract.address);
  console.log({
    contractName, contract: newContract.address, implAddress
  })
  return newContract
}

describe("Fair Launch", async () => {
  before(async () => {
    [owner, addr1, addr2, addr3, addr4, addrBurn, addrTreasury, ...addrs] = await ethers.getSigners();
    if(network.name=="hardhat" || true) {
      const daiFactory = await ethers.getContractFactory("FakeToken")
      DAI = await daiFactory.deploy("USDC", "USDC", 6, 1000000, owner.address)
      const routerFactory = await ethers.getContractFactory("FakeRouter")
      const router1 = await routerFactory.deploy()
      await router1.addLiquidityETH(
        DAI.address, 
        ethers.utils.parseUnits('25.462614', 6),
        0,
        0,
        owner.address,
        Math.floor(Date.now() / 1000) + 100,
        { value: ethers.utils.parseEther('564573.58294966') }
      )
      const router2 = await routerFactory.deploy()
      const router3 = await routerFactory.deploy()
      routers = [router1.address, router2.address, router3.address]
    } else {
      DAI = await ethers.getContractAt("Token", "0xefD766cCb38EaF1dfd701853BFCe31359239F305");
      const router1 = "0xeB45a3c4aedd0F47F345fB4c8A1802BB5740d725" // 9inch mainnet
      const router2 = "0xcC73b59F8D7b7c532703bDfea2808a28a488cF47" // 9mm mainnet
      const router3 = "0x165C3410fC91EF562C50559f7d2289fEbed552d9" // pulseX mainnet
      routers = [router1.address, router2.address, router3.address]
    }
    const args = [
      routers,
      DAI.address,
      CREATE_TOKEN_FEE_AMOUNT,
      FEE_PERCENT,
      OWNER_FEE_PERCENT,
      TARGET_MARKET_CAP,
      TARGET_LP_AMOUNT,
      TOTAL_SUPPLY
    ]

    fairLaunchV8 = await deployProxy("CoinHubLauncherV8", args)
    fairLaunchV9 = await deployProxy("CoinHubLauncherV8", args)
    fairLaunchV9 = await upgradeProxy("CoinHubLauncherV9", fairLaunchV9.address)
    await fairLaunchV9.setPlatformSellFeePercent(3)
    console.log(ethers.utils.formatEther(await fairLaunchV8.getFirstBuyFee(ethers.constants.AddressZero)))
  });

  // it("nothing", () => {})
  // return

  describe("Functions", async () => {
    it("create token v8", async () => {
      // console.log(ethers.utils.formatEther(await ethers.provider.getBalance(addr1.address)))
      const token_count = await fairLaunchV8.tokenCount();
      const buy_amount = ethers.utils.parseEther("0")
      const buy_fee = buy_amount.gt(0) ? await fairLaunchV8.getFirstBuyFee(ethers.constants.AddressZero) : ethers.utils.parseEther("10000")
      const totalAmount = buy_amount.add(CREATE_TOKEN_FEE_AMOUNT).add(buy_fee);
      const tx = await fairLaunchV8.connect(addr1).createToken("TestName", "TestSymbol", buy_amount, 0x1, 1, { value: totalAmount });
      const tx_result = await tx.wait();
      const evTokenCreated = tx_result.events.find(x => x.event == "TokenCreated")
      console.log(evTokenCreated.args)
      const token = evTokenCreated.args.token;
      tokenV8 = await ethers.getContractAt("Token", token)

      expect(token).to.equal(await fairLaunchV8.tokenList(token_count));
      expect(await fairLaunchV8.tokenCount()).to.equal(token_count + 1);
      // console.log(ethers.utils.formatEther(await ethers.provider.getBalance(addr1.address)))
      console.log("MarketCap", await fairLaunchV8.getTokenMarketCap(token))
      console.log("TokenPrice", await fairLaunchV8.getPrice(token))
    });
    
    it("create token v9", async () => {
      // console.log(ethers.utils.formatEther(await ethers.provider.getBalance(addr1.address)))
      const token_count = await fairLaunchV9.tokenCount();
      const buy_amount = ethers.utils.parseEther("0")
      const buy_fee = buy_amount.gt(0) ? await fairLaunchV9.getFirstBuyFee(ethers.constants.AddressZero) : ethers.utils.parseEther("10000")
      const totalAmount = buy_amount.add(CREATE_TOKEN_FEE_AMOUNT).add(buy_fee);
      const tx = await fairLaunchV9.connect(addr2).createToken("TestName", "TestSymbol", buy_amount, 0x1, 1, { value: totalAmount });
      const tx_result = await tx.wait();
      const evTokenCreated = tx_result.events.find(x => x.event == "TokenCreated")
      console.log(evTokenCreated.args)
      const token = evTokenCreated.args.token;
      tokenV9 = await ethers.getContractAt("Token", token)

      expect(token).to.equal(await fairLaunchV9.tokenList(token_count));
      expect(await fairLaunchV9.tokenCount()).to.equal(token_count + 1);
      // console.log(ethers.utils.formatEther(await ethers.provider.getBalance(addr1.address)))
      console.log("MarketCap", await fairLaunchV9.getTokenMarketCap(token))
      console.log("TokenPrice", await fairLaunchV9.getPrice(token))
    });

    it("buy/sell tokens", async () => {
      let launchedV8 = false
      let launchedV9 = true
      const mcV8 = []
      const mcV9 = []
      await tokenV8.connect(addr1).approve(fairLaunchV8.address, ethers.utils.parseEther('99999999999999999999'))
      await tokenV9.connect(addr2).approve(fairLaunchV9.address, ethers.utils.parseEther('99999999999999999999'))
      while(!launchedV8 || !launchedV9) {
        const isBuy = true // Math.random() > 0.1
        const amountBuy = ethers.utils.parseEther('1000000')
        // const amountBuy = ethers.utils.parseEther(String(Math.random() * 10_000_000))
        const amountSell = ethers.utils.parseEther(String(Math.random() * 10_000_000))
        const firstFeeV8 = await fairLaunchV8.getFirstBuyFee(tokenV8.address)
        const firstFeeV9 = await fairLaunchV9.getFirstBuyFee(tokenV9.address)
        if(!launchedV8) {
          try {
            if (isBuy) {
              const tx = await (await fairLaunchV8.connect(addr1).buyTokens(tokenV8.address, amountBuy, { value: amountBuy.add(firstFeeV8) })).wait()
              const evBuyTokens = tx.events.find(e => e.event=="BuyTokens")
              const evLiquidityAdded = tx.events.filter(e => e.event=="LiquidityAdded")
              const marketCap = await fairLaunchV8.getTokenMarketCap(tokenV8.address)
              console.log(
                "BuyTokens v8", 
                ethers.utils.formatEther(evBuyTokens.args.ethAmount), 
                ethers.utils.formatEther(evBuyTokens.args.tokenAmount),
                ethers.utils.formatEther(evBuyTokens.args.tokenPrice),
                marketCap,
              )
              mcV8.push(marketCap)
              if(evLiquidityAdded.length) {
                launchedV8 = true
                console.log(
                  "Launched v8", 
                  await fairLaunchV8.getTokenMarketCap(tokenV8.address),
                  evLiquidityAdded,
                )
              }
            } else {
              const tx = await (await fairLaunchV8.connect(addr1).sellTokens(tokenV8.address, amountSell)).wait()
              const evSellTokens = tx.events.find(e => e.event=="SellTokens")
              const marketCap = await fairLaunchV8.getTokenMarketCap(tokenV8.address)
              console.log(
                "SellTokens v8", 
                ethers.utils.formatEther(evSellTokens.args.ethAmount), 
                ethers.utils.formatEther(evSellTokens.args.tokenAmount),
                ethers.utils.formatEther(evSellTokens.args.tokenPrice),
                marketCap,
              )
              mcV8.push(marketCap)
            }
          } catch(ex) {
            console.log(ex)
          }
        }
        if(!launchedV9) {
          try {
            if (isBuy) {
              const tx = await (await fairLaunchV9.connect(addr2).swapExactETHForTokens(tokenV9.address, amountBuy, 0, { value: amountBuy.add(firstFeeV9) })).wait()
              const evBuyTokens = tx.events.find(e => e.event=="BuyTokens")
              // const evLiquidityAdded = tx.events.filter(e => e.event=="LiquidityAdded")
              const evTokenLaunched = tx.events.find(e => e.event=="TokenLaunched")
              console.log(
                "BuyTokens v9", 
                ethers.utils.formatEther(evBuyTokens.args.ethAmount), 
                ethers.utils.formatEther(evBuyTokens.args.tokenAmount),
                ethers.utils.formatEther(evBuyTokens.args.tokenPrice),
                ethers.utils.formatEther(evBuyTokens.args.ethPrice),
                ethers.utils.formatEther(evBuyTokens.args.marketCap)
              )
              mcV9.push(Number(ethers.utils.formatEther(evBuyTokens.args.marketCap)))
              if(evTokenLaunched) {
                launchedV9 = true
                const marketCap = ethers.utils.formatEther(await fairLaunchV9.getTokenMarketCap(tokenV9.address))
                console.log(
                  "Launched v9", 
                  marketCap,
                  ...evTokenLaunched.args.pairs
                )
                mcV9.push(Number(marketCap))
              }
            } else {
              const tx = await (await fairLaunchV9.connect(addr2).swapExactTokensForETH(tokenV9.address, amountSell, 0)).wait()
              const evSellTokens = tx.events.find(e => e.event=="SellTokens")
              console.log(
                "SellTokens v9", 
                ethers.utils.formatEther(evSellTokens.args.ethAmount), 
                ethers.utils.formatEther(evSellTokens.args.tokenAmount),
                ethers.utils.formatEther(evSellTokens.args.tokenPrice),
                ethers.utils.formatEther(evSellTokens.args.ethPrice),
                ethers.utils.formatEther(evSellTokens.args.marketCap)
              )
              mcV9.push(Number(ethers.utils.formatEther(evSellTokens.args.marketCap)))
            }
          } catch(ex) {
            console.log(ex)
          }
        }
      }
      fs.writeFileSync("mc.v8.csv", mcV8.join('\n'))
      fs.writeFileSync("mc.v9.csv", mcV9.join('\n'))
    });
  });
});
