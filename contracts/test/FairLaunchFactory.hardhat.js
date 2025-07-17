const { ethers } = require("hardhat");
const { expect } = require("chai");
const config = require("../config.json");
const { getImplementationAddress } = require('@openzeppelin/upgrades-core')

const FEE_PERCENT = 3;
const CREATE_TOKEN_FEE_AMOUNT = ethers.utils.parseEther("1000");
const OWNER_FEE_PERCENT = 0;
const TARGET_MARKET_CAP = 69000;
const TARGET_LP_AMOUNT = 12000;
const TOTAL_SUPPLY = 10 ** 9;
const INITIAL_AMOUNT = ethers.utils.parseEther("1000");

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

let owner, addr1, addr2, addr3, addr4, addrBurn, addrTreasury, addrs

const deployProxy = async (contractName, args = [] = []) => {
  const factory = await ethers.getContractFactory(contractName)
  const contract = await upgrades.deployProxy(factory, args, {
      initializer: "initialize",
  })
  await contract.deployed()
  const implAddress = await getImplementationAddress(ethers.provider, contract.address);
  // await updateABI(contractName)
  console.log({
      contractName, contract: contract.address, implAddress
  })
  return contract
}

describe("Fair Launch", async () => {
  before(async () => {
    [owner, addr1, addr2, addr3, addr4, addrBurn, addrTreasury, ...addrs] = await ethers.getSigners();
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
    // const router1 = "0xeB45a3c4aedd0F47F345fB4c8A1802BB5740d725" // 9inch mainnet
    // const router2 = "0xcC73b59F8D7b7c532703bDfea2808a28a488cF47" // 9mm mainnet
    // const router3 = "0x165C3410fC91EF562C50559f7d2289fEbed552d9" // pulseX mainnet
    routers = [router1.address, router2.address, router3.address]
    // //routers = [router1]
    fairLaunch = await deployProxy(
      "CoinHubLauncherV4",
      [
        routers, 
        DAI.address, 
        CREATE_TOKEN_FEE_AMOUNT, 
        FEE_PERCENT, 
        OWNER_FEE_PERCENT, 
        TARGET_MARKET_CAP, 
        TARGET_LP_AMOUNT, 
        TOTAL_SUPPLY, 
        INITIAL_AMOUNT
      ]
    );
  });

  // it("do", () => {})

  describe("Functions", async () => {
    it("Should create token", async () => {

      // addr1 = await ethers.getImpersonatedSigner("0xf121149c25C100E838d5DFCc574aDfb91BE6aEB4");

      const token_count = await fairLaunch.tokenCount();
      const eth_amount = ethers.utils.parseEther("0")
      const creation_fee = ethers.utils.parseEther("1000")
      const buy_amount = ethers.utils.parseEther("0")
      const buy_fee = buy_amount.eq(0) ? ethers.utils.parseEther("0") : await fairLaunch.getFirstBuyFee(ethers.constants.AddressZero)
      const totalAmount = eth_amount.add(creation_fee).add(buy_amount).add(buy_fee);
      const tx = await fairLaunch.connect(addr1).createToken("TestName", "TestSymbol", buy_amount, 0x1, 1, { value: totalAmount });
      const tx_result = await tx.wait();
      newToken = tx_result.events.filter(x => x.event == "TokenCreated")[0].args[0];
      newTokenContract = await ethers.getContractAt("Token", newToken);

      expect(newToken).to.equal(await fairLaunch.tokenList(token_count));
      expect(await fairLaunch.tokenCount()).to.equal(token_count + 1);

      const pool = await fairLaunch.tokenPools(newToken);
      const ethReserve = ethers.utils.formatEther(pool.ethReserve);
      const tokenReserve = ethers.utils.formatEther(pool.tokenReserve);
      const launched = pool.launched;
      const token = pool.token;
      const owner = pool.owner;
      const totalSupply = ethers.utils.formatEther(await newTokenContract.totalSupply());

      console.log("New Token Address: ", newToken);
      console.log("Fair Contract Address: ", fairLaunch.address);
      console.log("ethReserve: ", ethReserve);
      console.log("tokenReserve: ", tokenReserve);
      console.log("launched: ", launched);
      console.log("token: ", token);
      console.log("owner: ", owner);
      console.log("Total Supply: ", totalSupply);

      const tokenPrice = await fairLaunch.getPrice(newToken);
      const contractTokenBalance = await newTokenContract.balanceOf(fairLaunch.address);
      const contractEthBalance = await ethers.provider.getBalance(fairLaunch.address);
      const ethPriceByUSD = await fairLaunch.getETHPriceByUSD();
      const marketCap = await fairLaunch.getTokenMarketCap(newToken);
      console.log("Token Price: ", ethers.utils.formatEther(tokenPrice));
      console.log("Contract Token Balance: ", ethers.utils.formatEther(contractTokenBalance));
      console.log("Contract ETH Balance: ", ethers.utils.formatEther(contractEthBalance));
      console.log("ETH Price: ", ethers.utils.formatEther(ethPriceByUSD));
      console.log("TokenMarketCap: ", ethers.utils.formatUnits(marketCap, 2));

      //console.log("Addr2 Token Balance: ", await newTokenContract.balanceOf(addr1.address));
      //console.log("Addr2 ETH Balance: ", await addr1.getBalance());
    });

    it("Buy Token", async () => {
      const eth_amount = ethers.utils.parseEther("100000000");

      for (let i = 0; i < 30; i++) {
        console.log("Token Pools: ", await fairLaunch.tokenPools(newToken));
        console.log("Token Price: ", await fairLaunch.getPrice(newToken));

        const addr2TokenBalanceBefore = await newTokenContract.balanceOf(addr2.address);
        const addr2EthBalanceBefore = await addr2.getBalance();
        console.log("Addr2 Token Balance Before: ", ethers.utils.formatEther(addr2TokenBalanceBefore));
        console.log("Addr2 ETH Balance Before: ", ethers.utils.formatEther(addr2EthBalanceBefore));

        let tokenPrice = await fairLaunch.getPrice(newToken);
        let contractTokenBalance = await newTokenContract.balanceOf(fairLaunch.address);
        let contractEthBalance = await ethers.provider.getBalance(fairLaunch.address);
        let ethPriceByUSD = await fairLaunch.getETHPriceByUSD();
        let marketCap = await fairLaunch.getTokenMarketCap(newToken);
        console.log("Token Price: ", ethers.utils.formatEther(tokenPrice));
        console.log("Contract Token Balance: ", ethers.utils.formatEther(contractTokenBalance));
        console.log("Contract ETH Balance: ", ethers.utils.formatEther(contractEthBalance));
        console.log("ETH Price: ", ethers.utils.formatEther(ethPriceByUSD));
        console.log("TokenMarketCap: ", ethers.utils.formatUnits(marketCap, 2));
        //console.log("Addr2 Token Balance After: ", ethers.utils.formatEther(addr2TokenBalanceAfter));
        //console.log("Addr2 ETH Balance After: ", ethers.utils.formatEther(addr2EthBalanceAfter));

        const buy_fee = await fairLaunch.getFirstBuyFee(newToken)
        await fairLaunch.connect(addr2).buyTokens(newToken, eth_amount, { value: eth_amount.add(buy_fee) });
        // const addr2TokenBalanceAfter = await newTokenContract.balanceOf(addr2.address);
        // const addr2EthBalanceAfter = await addr2.getBalance();
        // const b = addr2TokenBalanceBefore.add(eth_amount.mul(TOTAL_SUPPLY).mul(100 - FEE_PERCENT - OWNER_FEE_PERCENT).div(100))

        // expect(ethers.utils.formatEther(addr2TokenBalanceAfter)).to.equal(ethers.utils.formatEther((b)));
        //expect(await addr2.getBalance()).to.be.lt(addr2_eth.sub(eth_amount));


        const pool = await fairLaunch.tokenPools(newToken);
        const ethReserve = ethers.utils.formatEther(pool.ethReserve);
        const tokenReserve = ethers.utils.formatEther(pool.tokenReserve);
        const launched = pool.launched;
        const token = pool.token;
        const owner = pool.owner;
        const totalSupply = ethers.utils.formatEther(await newTokenContract.totalSupply());

        console.log("New Token Address: ", newToken);
        console.log("Fair Contract Address: ", fairLaunch.address);
        console.log("ethReserve: ", ethReserve);
        console.log("tokenReserve: ", tokenReserve);
        console.log("launched: ", launched);
        console.log("token: ", token);
        console.log("owner: ", owner);
        console.log("Total Supply: ", totalSupply);

        tokenPrice = await fairLaunch.getPrice(newToken);
        contractTokenBalance = await newTokenContract.balanceOf(fairLaunch.address);
        contractEthBalance = await ethers.provider.getBalance(fairLaunch.address);
        ethPriceByUSD = await fairLaunch.getETHPriceByUSD();
        marketCap = await fairLaunch.getTokenMarketCap(newToken);
        console.log("Token Price: ", ethers.utils.formatEther(tokenPrice));
        console.log("Contract Token Balance After: ", ethers.utils.formatEther(contractTokenBalance));
        console.log("Contract ETH Balance After: ", ethers.utils.formatEther(contractEthBalance));
        console.log("ETH Price: ", ethers.utils.formatEther(ethPriceByUSD));
        console.log("TokenMarketCap: ", ethers.utils.formatUnits(marketCap, 2));

        console.log('===============================', launched ? 'end' : (i + 1), '======================================')
        if (launched)
          break
        // console.log("Addr2 Token Balance After: ", ethers.utils.formatEther(addr2TokenBalanceAfter));
        // console.log("Addr2 ETH Balance After: ", ethers.utils.formatEther(addr2EthBalanceAfter));
      }
    });

  // //   // it("Should check routers lp balances", async () => {
  // //   //   for (let i = 0; i < routers.length; i++) {
  // //   //     const router = await ethers.getContractAt("INineInchRouter02", routers[i]);
  // //   //     //const weth = await router.WETH();
  // //   //     const weth = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27"; // weth mainnet
  // //   //     const factory = await router.factory();
  // //   //     const factoryContract = await ethers.getContractAt("INineInchFactory", factory);
  // //   //     const lp = await factoryContract.getPair(weth, newToken);
  // //   //     const lpContract = await ethers.getContractAt("INineInchPair", lp);
  // //   //     const lpBalance = await lpContract.balanceOf(addr1.address);
  // //   //     console.log("LP Address: ", lp);
  // //   //     console.log("LP Balance: ", ethers.utils.formatEther(lpBalance));
  // //   //   }
  // //   // })

  });
});




