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
    DAI = await ethers.getContractAt("Token", "0xefD766cCb38EaF1dfd701853BFCe31359239F305");
    //const routerFactory = await ethers.getContractFactory("FakeRouter")
    const router1 = await ethers.getContractAt("INineInchRouter02", "0xeB45a3c4aedd0F47F345fB4c8A1802BB5740d725")
    routers = [router1.address]
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

    fairLaunchV9 = await deployProxy("CoinHubLauncherV9_1", args)
    await fairLaunchV9.setPlatformBuyFeePercent(3)
    await fairLaunchV9.setPlatformSellFeePercent(3)
  });

  // it("nothing", () => {})
  // return

  describe("Functions", async () => {
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

    it("buy", async () => {
      const amountBuy = ethers.utils.parseEther("1")
      const firstFeeV9 = await fairLaunchV9.getFirstBuyFee(tokenV9.address)
      try {
        const tx = await (await fairLaunchV9.connect(addr2).swapExactETHForTokens(tokenV9.address, amountBuy, 0, { value: amountBuy.add(firstFeeV9) })).wait()
        const evBuyTokens = tx.events.find(e => e.event == "BuyTokens")
        console.log({
          action: "BuyTokens v9",
          ethAmount: ethers.utils.formatEther(evBuyTokens.args.ethAmount),
          tokenAmount: ethers.utils.formatEther(evBuyTokens.args.tokenAmount),
          tokenPrice: ethers.utils.formatEther(evBuyTokens.args.tokenPrice),
          ethPrice: ethers.utils.formatEther(evBuyTokens.args.ethPrice),
          marketCap: ethers.utils.formatEther(evBuyTokens.args.marketCap)
        })
      } catch (ex) {
        console.log(ex)
      }
    });

    it("Sell", async () => {
      await tokenV9.connect(addr2).approve(fairLaunchV9.address, ethers.utils.parseEther('99999999999999999999'))

      const addr2Balance = await tokenV9.balanceOf(addr2.address)
      const amountSell = addr2Balance

      try {

        const tx = await (await fairLaunchV9.connect(addr2).swapExactTokensForETH(tokenV9.address, amountSell, 0)).wait()
        const evSellTokens = tx.events.find(e => e.event == "SellTokens")
        console.log({
          action: "SellTokens v9",
          ethAmount: ethers.utils.formatEther(evSellTokens.args.ethAmount),
          tokenAmount: ethers.utils.formatEther(evSellTokens.args.tokenAmount),
          tokenPrice: ethers.utils.formatEther(evSellTokens.args.tokenPrice),
          ethPrice: ethers.utils.formatEther(evSellTokens.args.ethPrice),
          marketCap: ethers.utils.formatEther(evSellTokens.args.marketCap)
        })
      } catch (ex) {
        console.log(ex)
      }
    });
  });
});
