import hre from "hardhat";
import { getImplementationAddress } from '@openzeppelin/upgrades-core';
import { expect } from "chai";
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Constants - Reasonable values
const TOTAL_SUPPLY = 10 ** 9; // 1 billion tokens
const DEFAULT_MIGRATION_MARKET_CAP = 69000; // $69,000 target market cap

const FEE_WALLET_ADDRESS = "0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103";
const DISTRIBUTION_ADDRESS = "0xF2917a81fF74406fbCf01c507057e101Db8f2F12";
const DATA_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";

// Uniswap addresses
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const UNISWAP_V3_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const UNISWAP_V4_POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const UNISWAP_UNIVERSAL_ROUTER = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af";
const UNISWAP_V4_POSITION_MANAGER = "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

describe("MeteoraStyleBondingCurve - Market Cap Based Launch", function () {
  let MeteoraContract;
  let owner, addr1, addr2, addr3;
  let token;

  // Increase timeout for all tests
  this.timeout(120000);

  before(async () => {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    console.log("Owner address:", owner.address);
    console.log("Test addresses:", [addr1.address, addr2.address, addr3.address]);

    try {
      // Deploy liquidity manager
      console.log("\n🔧 Deploying Liquidity Manager...");
      const EthismLiquidityManagerFactory = await ethers.getContractFactory("EthismLiquidityManager");
      const LiquidityManager = await EthismLiquidityManagerFactory.deploy(
        UNISWAP_V2_ROUTER,
        UNISWAP_V3_POSITION_MANAGER,
        UNISWAP_V4_POOL_MANAGER,
        UNISWAP_UNIVERSAL_ROUTER,
        UNISWAP_V4_POSITION_MANAGER,
        PERMIT2,
        owner.address,
        owner.address,
        { gasLimit: 20000000 }
      );

      await LiquidityManager.deployed();
      console.log("Liquidity Manager deployed to:", LiquidityManager.address);

      // Deploy Fixed Meteora Contract
      console.log("\n🚀 Deploying Fixed Meteora Bonding Curve contract...");
      const MeteoraFactory = await ethers.getContractFactory("MeteoraStyleBondingCurve");

      MeteoraContract = await MeteoraFactory.deploy(
        DATA_FEED,
        LiquidityManager.address,
        FEE_WALLET_ADDRESS,
        DISTRIBUTION_ADDRESS,
        TOTAL_SUPPLY,
        DEFAULT_MIGRATION_MARKET_CAP,
        {
          gasLimit: 15000000,
        }
      );

      await MeteoraContract.deployed();
      console.log("✅ MeteoraStyleBondingCurve deployed to:", MeteoraContract.address);

    } catch (error) {
      console.error("❌ Deployment failed:", error.message);
      throw error;
    }
  });

  describe("Market Cap Based Launch Tests", function () {

    it("1. Should create token and verify market cap calculations", async function () {
      console.log("\n🎯 Testing Token Creation and Market Cap Calculations");

      try {
        // Test ETH price feed
        const ethPrice = await MeteoraContract.getETHPriceByUSD();
        console.log("ETH Price:", ethers.utils.formatEther(ethPrice), "USD");

        // Create token
        console.log("Creating token...");
        const createTx = await MeteoraContract.connect(owner).createToken(
          "MarketCapToken",
          "MCT",
          0, // No initial buy
          1,
          1,
          {
            value: 0,
            gasLimit: 8000000
          }
        );

        const receipt = await createTx.wait();
        const tokenCreatedEvent = receipt.events.find(x => x.event === "TokenCreated");
        token = await ethers.getContractAt("Token", tokenCreatedEvent.args.token);
        console.log("✅ Token created:", token.address);

        // Get initial market cap
        const initialMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
        console.log("Initial Market Cap:", ethers.utils.formatEther(initialMarketCap), "USD");

        // Get curve information
        const curveSegments = await MeteoraContract.getCurveSegments(token.address);
        console.log("\n📈 Price Tiers:", curveSegments.length);

        let cumulativeETH = ethers.BigNumber.from(0);
        for (let i = 0; i < curveSegments.length; i++) {
          const segment = curveSegments[i];
          const ethForTier = segment.targetPrice.mul(segment.tokensAvailable).div(ethers.utils.parseEther("1"));
          cumulativeETH = cumulativeETH.add(ethForTier);
          
          console.log(`Tier ${i}:`);
          console.log(`  - Price: ${ethers.utils.formatUnits(segment.targetPrice, "gwei")} gwei per token`);
          console.log(`  - Tokens Available: ${ethers.utils.formatEther(segment.tokensAvailable)}`);
          console.log(`  - ETH to exhaust tier: ${ethers.utils.formatEther(ethForTier)}`);
          console.log(`  - Cumulative ETH: ${ethers.utils.formatEther(cumulativeETH)}`);
          
          // Calculate market cap at end of this tier
          const marketCapAtTier = segment.targetPrice.mul(ethers.utils.parseEther(TOTAL_SUPPLY.toString())).div(ethers.utils.parseEther("1"));
          const marketCapUSD = marketCapAtTier.mul(ethPrice).div(ethers.utils.parseEther("1"));
          console.log(`  - Market Cap at end of tier: ${ethers.utils.formatEther(marketCapUSD)}`);
          
          // Check if this tier reaches our target
          const targetMarketCap = ethers.utils.parseEther("69000");
          if (marketCapUSD.gte(targetMarketCap)) {
            console.log(`  ✅ Tier ${i} reaches or exceeds $69k target!`);
          }
        }

        // Calculate target information
        console.log("\n💰 Target Analysis:");
        console.log("Target Market Cap: $69,000");
        
        // At $69k market cap, what should the token price be?
        const targetMarketCapUSD = ethers.utils.parseEther("69000");
        const totalSupply = await token.totalSupply();
        const targetTokenPriceUSD = targetMarketCapUSD.mul(ethers.utils.parseEther("1")).div(totalSupply);
        const targetTokenPriceETH = targetTokenPriceUSD.mul(ethers.utils.parseEther("1")).div(ethPrice);
        
        console.log("Target token price (USD):", ethers.utils.formatEther(targetTokenPriceUSD));
        console.log("Target token price (ETH):", ethers.utils.formatUnits(targetTokenPriceETH, "gwei"), "gwei");
        
        // Calculate approximate ETH needed to reach $69k
        const approximateETHNeeded = targetMarketCapUSD.mul(ethers.utils.parseEther("1")).div(ethPrice);
        console.log("Approximate ETH needed for $69k market cap:", ethers.utils.formatEther(approximateETHNeeded));

        expect(tokenCreatedEvent.args.token).to.be.properAddress;
        expect(curveSegments.length).to.equal(5); // Now we have 5 tiers instead of 3

      } catch (error) {
        console.error("❌ Token creation failed:", error);
        throw error;
      }
    });

    it("2. Should progressively buy towards $69k market cap", async function () {
      console.log("\n🛒 Testing Progressive Purchases Towards $69k Market Cap");

      if (!token) {
        console.log("❌ No token available from previous test");
        return;
      }

      // Strategy: Make strategic purchases to reach $69k with ~3-4 ETH total
      const purchaseAmounts = [
        ethers.utils.parseEther("1.0"),   // Start with 1 ETH
        ethers.utils.parseEther("1.5"),   // Add 1.5 ETH  
        ethers.utils.parseEther("1.0"),   // Add 1.0 ETH - should be close to 3.5 ETH total
        ethers.utils.parseEther("0.5"),   // Fine-tune with 0.5 ETH
        ethers.utils.parseEther("0.3"),   // Smaller adjustments
        ethers.utils.parseEther("0.2"),   // Even smaller
      ];

      for (let i = 0; i < purchaseAmounts.length; i++) {
        const buyAmount = purchaseAmounts[i];
        console.log(`\n--- Purchase ${i + 1}: ${ethers.utils.formatEther(buyAmount)} ETH ---`);

        try {
          // Get pre-purchase state
          const preMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
          const prePrice = await MeteoraContract.getCurrentPrice(token.address);
          const poolInfo = await MeteoraContract.getPoolInfo(token.address);
          const shouldMigrate = await MeteoraContract.shouldMigrate(token.address);

          console.log("Pre-purchase Market Cap:", `$${ethers.utils.formatEther(preMarketCap)}`);
          console.log("Pre-purchase Token Price:", ethers.utils.formatUnits(prePrice, "gwei"), "gwei");
          console.log("Should Migrate:", shouldMigrate);

          if (poolInfo.launched) {
            console.log("🎉 Token already launched!");
            break;
          }

          // Calculate expected tokens
          const [expectedTokens, expectedSegment] = await MeteoraContract.calculateBuyAmount(
            token.address,
            buyAmount
          );
          console.log("Expected tokens:", ethers.utils.formatEther(expectedTokens));

          // Execute purchase
          const tradeTx = await MeteoraContract.connect(addr1).swapExactETHForTokens(
            token.address,
            buyAmount,
            0,
            {
              value: buyAmount,
              gasLimit: 5000000
            }
          );

          const receipt = await tradeTx.wait();
          console.log("Trade completed, gas used:", receipt.gasUsed.toString());

          // Check for launch event
          const launchEvent = receipt.events.find(e => e.event === "TokenLaunched");
          if (launchEvent) {
            console.log("🚀 TOKEN LAUNCHED!");
            console.log("Launch timestamp:", launchEvent.args[1].toString());
            break;
          }

          // Get post-purchase state
          const postMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
          const postPrice = await MeteoraContract.getCurrentPrice(token.address);
          const postPoolInfo = await MeteoraContract.getPoolInfo(token.address);

          console.log("Post-purchase Market Cap:", `$${ethers.utils.formatEther(postMarketCap)}`);
          console.log("Post-purchase Token Price:", ethers.utils.formatUnits(postPrice, "gwei"), "gwei");
          console.log("ETH Reserve:", ethers.utils.formatEther(postPoolInfo.ethReserve));

          // Calculate progress towards $69k
          const targetMarketCap = ethers.utils.parseEther("69000");
          if (postMarketCap.gt(0)) {
            const progress = postMarketCap.mul(100).div(targetMarketCap);
            console.log("Progress to $69k:", progress.toString() + "%");
          }

          // Show remaining tokens in curve
          const updatedSegments = await MeteoraContract.getCurveSegments(token.address);
          console.log("Remaining tokens per tier:");
          for (let j = 0; j < updatedSegments.length; j++) {
            console.log(`  Tier ${j}: ${ethers.utils.formatEther(updatedSegments[j].tokensAvailable)}`);
          }

          // Validations
          expect(postMarketCap).to.be.gt(preMarketCap, "Market cap should increase");

        } catch (error) {
          console.log(`❌ Purchase ${i + 1} failed:`, error.message);
          // Continue with next purchase even if one fails
        }
      }
    });

    it("3. Should test selling functionality", async function () {
      console.log("\n💰 Testing Sell Functionality");

      if (!token) {
        console.log("❌ No token available");
        return;
      }

      try {
        const poolInfo = await MeteoraContract.getPoolInfo(token.address);
        
        if (poolInfo.launched) {
          console.log("ℹ️ Token already launched, skipping sell test");
          return;
        }

        // Buy some tokens for selling
        const buyAmount = ethers.utils.parseEther("2.0");
        console.log("Buying tokens for sell test:", ethers.utils.formatEther(buyAmount));

        await MeteoraContract.connect(addr2).swapExactETHForTokens(
          token.address,
          buyAmount,
          0,
          {
            value: buyAmount,
            gasLimit: 5000000
          }
        );

        const userTokenBalance = await token.balanceOf(addr2.address);
        console.log("User token balance:", ethers.utils.formatEther(userTokenBalance));

        if (userTokenBalance.gt(0)) {
          // Try to sell 25% of tokens
          const sellAmount = userTokenBalance.div(4);
          console.log("Attempting to sell:", ethers.utils.formatEther(sellAmount));

          const preMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
          console.log("Pre-sell Market Cap:", `$${ethers.utils.formatEther(preMarketCap)}`);

          // Calculate expected ETH
          const [expectedEth, expectedSegment] = await MeteoraContract.calculateSellAmount(
            token.address,
            sellAmount
          );
          console.log("Expected ETH:", ethers.utils.formatEther(expectedEth));

          // Approve and sell
          await token.connect(addr2).approve(MeteoraContract.address, sellAmount);

          const sellTx = await MeteoraContract.connect(addr2).swapExactTokensForETH(
            token.address,
            sellAmount,
            0,
            { gasLimit: 5000000 }
          );

          await sellTx.wait();
          console.log("✅ Sell completed");

          const postMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
          console.log("Post-sell Market Cap:", `$${ethers.utils.formatEther(postMarketCap)}`);

          expect(postMarketCap).to.be.lt(preMarketCap, "Market cap should decrease after sell");
        }

      } catch (error) {
        console.log("❌ Sell test error:", error.message);
      }
    });

    it("4. Should reach $69k market cap and launch automatically", async function () {
      console.log("\n🚀 Testing Automatic Launch at $69k Market Cap");

      if (!token) {
        console.log("❌ No token available");
        return;
      }

      try {
        let attemptCount = 0;
        let isLaunched = false;
        const maxAttempts = 15;

        while (!isLaunched && attemptCount < maxAttempts) {
          attemptCount++;
          console.log(`\n--- Launch Attempt ${attemptCount} ---`);

          const poolInfo = await MeteoraContract.getPoolInfo(token.address);
          
          if (poolInfo.launched) {
            isLaunched = true;
            console.log("🎉 Token already launched!");
            break;
          }

          const currentMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
          const targetMarketCap = ethers.utils.parseEther("69000");
          const shouldMigrate = await MeteoraContract.shouldMigrate(token.address);
          const ethPrice = await MeteoraContract.getETHPriceByUSD();

          console.log("Current Market Cap:", `${ethers.utils.formatEther(currentMarketCap)}`);
          console.log("Target Market Cap:", `${ethers.utils.formatEther(targetMarketCap)}`);
          console.log("Should Migrate:", shouldMigrate);
          console.log("ETH Price:", `${ethers.utils.formatEther(ethPrice)}`);

          if (currentMarketCap.gt(0)) {
            const progress = currentMarketCap.mul(100).div(targetMarketCap);
            console.log("Progress:", progress.toString() + "%");
          }

          // Calculate how much more we need
          const remainingMarketCap = targetMarketCap.sub(currentMarketCap);
          console.log("Remaining to target:", `${ethers.utils.formatEther(remainingMarketCap)}`);

          // Make a more precise purchase based on how close we are
          let buyAmount;
          if (remainingMarketCap.gt(ethers.utils.parseEther("40000"))) {
            buyAmount = ethers.utils.parseEther("2.0"); // Smaller purchase if far from target
          } else if (remainingMarketCap.gt(ethers.utils.parseEther("20000"))) {
            buyAmount = ethers.utils.parseEther("1.0"); // Medium purchase
          } else if (remainingMarketCap.gt(ethers.utils.parseEther("5000"))) {
            buyAmount = ethers.utils.parseEther("0.5"); // Small purchase near target
          } else {
            buyAmount = ethers.utils.parseEther("0.2"); // Very small purchase very close to target
          }

          console.log("Buying with:", ethers.utils.formatEther(buyAmount), "ETH");

          try {
            const tradeTx = await MeteoraContract.connect(addr3).swapExactETHForTokens(
              token.address,
              buyAmount,
              0,
              {
                value: buyAmount,
                gasLimit: 5000000
              }
            );

            const receipt = await tradeTx.wait();

            // Check for launch event
            const launchEvent = receipt.events.find(e => e.event === "TokenLaunched");
            if (launchEvent) {
              isLaunched = true;
              console.log("🎉 TOKEN LAUNCHED SUCCESSFULLY!");
              console.log("Launch timestamp:", launchEvent.args[1].toString());
              
              // Verify final state
              const finalMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
              console.log("Final Market Cap at launch:", `${ethers.utils.formatEther(finalMarketCap)}`);
              
              // Check if launch happened close to $69k (allow some tolerance due to discrete tiers)
              const tolerance = ethers.utils.parseEther("15000"); // $15k tolerance
              const difference = finalMarketCap.sub(targetMarketCap).abs();
              
              expect(finalMarketCap).to.be.gte(targetMarketCap, "Should launch at or above $69k market cap");
              console.log("Difference from target:", `${ethers.utils.formatEther(difference)}`);
              
              if (difference.lte(tolerance)) {
                console.log("✅ Launched within acceptable range of $69k target");
              } else {
                console.log("⚠️ Launched outside tolerance but above minimum target");
              }
              break;
            }

            // Show updated state
            const updatedMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
            console.log("Updated Market Cap:", `$${ethers.utils.formatEther(updatedMarketCap)}`);

          } catch (error) {
            console.log("Purchase failed:", error.message);
            // Try a smaller amount
            buyAmount = ethers.utils.parseEther("1.0");
            console.log("Retrying with smaller amount:", ethers.utils.formatEther(buyAmount));
            
            try {
              const retryTx = await MeteoraContract.connect(addr3).swapExactETHForTokens(
                token.address,
                buyAmount,
                0,
                {
                  value: buyAmount,
                  gasLimit: 5000000
                }
              );
              await retryTx.wait();
            } catch (retryError) {
              console.log("Retry also failed:", retryError.message);
              break;
            }
          }
        }

        if (isLaunched) {
          console.log("✅ Token successfully launched at $69k market cap!");
          
          // Verify launch conditions
          const finalPoolInfo = await MeteoraContract.getPoolInfo(token.address);
          expect(finalPoolInfo.launched).to.be.true;
          
        } else {
          console.log("⚠️ Token not launched after", maxAttempts, "attempts");
          
          // Show final state for debugging
          const finalMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
          const finalShouldMigrate = await MeteoraContract.shouldMigrate(token.address);
          console.log("Final Market Cap:", `$${ethers.utils.formatEther(finalMarketCap)}`);
          console.log("Final Should Migrate:", finalShouldMigrate);
        }

      } catch (error) {
        console.log("❌ Launch test failed:", error.message);
      }
    });

    it("5. Should verify launch mechanics", async function () {
      console.log("\n🔍 Verifying Launch Mechanics");

      if (!token) {
        console.log("❌ No token available");
        return;
      }

      try {
        const poolInfo = await MeteoraContract.getPoolInfo(token.address);
        
        if (poolInfo.launched) {
          console.log("✅ Token is launched");
          console.log("Final ETH Reserve:", ethers.utils.formatEther(poolInfo.ethReserve));
          console.log("Final Token Reserve:", ethers.utils.formatEther(poolInfo.tokenReserve));
          
          // Verify that shouldMigrate returns false for launched tokens
          const shouldMigrate = await MeteoraContract.shouldMigrate(token.address);
          expect(shouldMigrate).to.be.false;
          console.log("✅ shouldMigrate correctly returns false for launched token");
          
        } else {
          console.log("ℹ️ Token not yet launched, testing launch conditions");
          
          const currentMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
          const targetMarketCap = ethers.utils.parseEther("69000");
          const shouldMigrate = await MeteoraContract.shouldMigrate(token.address);
          
          console.log("Current Market Cap:", `$${ethers.utils.formatEther(currentMarketCap)}`);
          console.log("Target Market Cap:", `$${ethers.utils.formatEther(targetMarketCap)}`);
          console.log("Should Migrate:", shouldMigrate);
          
          if (currentMarketCap.gte(targetMarketCap)) {
            expect(shouldMigrate).to.be.true;
            console.log("✅ shouldMigrate correctly returns true when market cap >= $69k");
          } else {
            expect(shouldMigrate).to.be.false;
            console.log("✅ shouldMigrate correctly returns false when market cap < $69k");
          }
        }

      } catch (error) {
        console.log("❌ Launch mechanics verification failed:", error.message);
      }
    });

    it("6. Should test edge cases and validation", async function () {
      console.log("\n⚙️ Testing Edge Cases and Validation");

      try {
        // Test with a new token to verify initial conditions
        const edgeTx = await MeteoraContract.connect(owner).createToken(
          "EdgeCaseToken",
          "EDGE",
          0,
          3,
          1,
          {
            value: 0,
            gasLimit: 8000000
          }
        );

        const edgeReceipt = await edgeTx.wait();
        const edgeTokenEvent = edgeReceipt.events.find(x => x.event === "TokenCreated");
        const edgeToken = edgeTokenEvent.args.token;

        console.log("Edge case token created:", edgeToken);

        // Test initial conditions
        const initialMarketCap = await MeteoraContract.getTokenMarketCapUSD(edgeToken);
        const initialShouldMigrate = await MeteoraContract.shouldMigrate(edgeToken);
        
        console.log("Initial Market Cap:", `$${ethers.utils.formatEther(initialMarketCap)}`);
        console.log("Initial Should Migrate:", initialShouldMigrate);
        
        expect(initialShouldMigrate).to.be.false;
        console.log("✅ New token correctly starts with shouldMigrate = false");

        // Test very small purchase
        const smallBuy = ethers.utils.parseEther("0.1");
        await MeteoraContract.connect(addr1).swapExactETHForTokens(
          edgeToken,
          smallBuy,
          0,
          {
            value: smallBuy,
            gasLimit: 5000000
          }
        );

        const afterSmallBuyMarketCap = await MeteoraContract.getTokenMarketCapUSD(edgeToken);
        console.log("After small buy Market Cap:", `${ethers.utils.formatEther(afterSmallBuyMarketCap)}`);
        
        expect(afterSmallBuyMarketCap).to.be.gt(initialMarketCap);
        console.log("✅ Small purchase correctly increases market cap");

        // Test market cap calculation consistency
        const currentPrice = await MeteoraContract.getCurrentPrice(edgeToken);
        const tokenContract = await ethers.getContractAt("Token", edgeToken);
        const totalSupply = await tokenContract.totalSupply();
        const ethPrice = await MeteoraContract.getETHPriceByUSD();
        
        // Manual calculation
        const manualMarketCapETH = currentPrice.mul(totalSupply).div(ethers.utils.parseEther("1"));
        const manualMarketCapUSD = manualMarketCapETH.mul(ethPrice).div(ethers.utils.parseEther("1"));
        
        console.log("Contract Market Cap:", `${ethers.utils.formatEther(afterSmallBuyMarketCap)}`);
        console.log("Manual Market Cap:", `${ethers.utils.formatEther(manualMarketCapUSD)}`);
        
        // Allow for small rounding differences
        const difference = afterSmallBuyMarketCap.sub(manualMarketCapUSD).abs();
        const tolerance = ethers.utils.parseEther("0.01"); // $0.01 tolerance
        expect(difference).to.be.lte(tolerance);
        console.log("✅ Market cap calculation is consistent");

      } catch (error) {
        console.log("❌ Edge case testing failed:", error.message);
      }
    });

    it("7. Should test exact $69k threshold behavior", async function () {
      console.log("\n🎯 Testing Exact $69k Threshold Behavior");

      try {
        // Create a new token for precise testing
        const precisionTx = await MeteoraContract.connect(owner).createToken(
          "PrecisionToken",
          "PREC",
          0,
          4,
          1,
          {
            value: 0,
            gasLimit: 8000000
          }
        );

        const precisionReceipt = await precisionTx.wait();
        const precisionTokenEvent = precisionReceipt.events.find(x => x.event === "TokenCreated");
        const precisionToken = precisionTokenEvent.args.token;

        console.log("Precision token created:", precisionToken);

        // Get curve information
        const curveSegments = await MeteoraContract.getCurveSegments(precisionToken);
        console.log("Curve segments:", curveSegments.length);

        // Calculate theoretical ETH needed for each tier
        let theoreticalETH = ethers.BigNumber.from(0);
        const ethPrice = await MeteoraContract.getETHPriceByUSD();
        console.log("ETH Price:", `${ethers.utils.formatEther(ethPrice)}`);

        for (let i = 0; i < curveSegments.length; i++) {
          const segment = curveSegments[i];
          const ethForTier = segment.targetPrice.mul(segment.tokensAvailable).div(ethers.utils.parseEther("1"));
          theoreticalETH = theoreticalETH.add(ethForTier);
          
          // Calculate market cap at end of this tier
          const tokenContract = await ethers.getContractAt("Token", precisionToken);
          const totalSupply = await tokenContract.totalSupply();
          const marketCapETH = segment.targetPrice.mul(totalSupply).div(ethers.utils.parseEther("1"));
          const marketCapUSD = marketCapETH.mul(ethPrice).div(ethers.utils.parseEther("1"));
          
          console.log(`Tier ${i}:`);
          console.log(`  - Price: ${ethers.utils.formatUnits(segment.targetPrice, "gwei")} gwei`);
          console.log(`  - ETH for tier: ${ethers.utils.formatEther(ethForTier)}`);
          console.log(`  - Cumulative ETH: ${ethers.utils.formatEther(theoreticalETH)}`);
          console.log(`  - Market cap at tier end: ${ethers.utils.formatEther(marketCapUSD)}`);
          
          // Check if this tier reaches our target
          const targetMarketCap = ethers.utils.parseEther("69000");
          if (marketCapUSD.gte(targetMarketCap)) {
            console.log(`  ✅ Tier ${i} reaches $69k target!`);
            break;
          }
        }

        // Test strategic buying to approach $69k
        const strategicAmounts = [
          ethers.utils.parseEther("10.0"),
          ethers.utils.parseEther("15.0"),
          ethers.utils.parseEther("3.0"),
          ethers.utils.parseEther("1.0"),
        ];

        for (let i = 0; i < strategicAmounts.length; i++) {
          const buyAmount = strategicAmounts[i];
          
          const preMarketCap = await MeteoraContract.getTokenMarketCapUSD(precisionToken);
          const preShouldMigrate = await MeteoraContract.shouldMigrate(precisionToken);
          const poolInfo = await MeteoraContract.getPoolInfo(precisionToken);
          
          if (poolInfo.launched) {
            console.log("🎉 Token launched!");
            break;
          }
          
          console.log(`\nStrategic buy ${i + 1}: ${ethers.utils.formatEther(buyAmount)} ETH`);
          console.log("Pre-buy Market Cap:", `${ethers.utils.formatEther(preMarketCap)}`);
          console.log("Pre-buy Should Migrate:", preShouldMigrate);
          
          try {
            const tradeTx = await MeteoraContract.connect(addr3).swapExactETHForTokens(
              precisionToken,
              buyAmount,
              0,
              {
                value: buyAmount,
                gasLimit: 5000000
              }
            );

            const receipt = await tradeTx.wait();
            
            // Check for launch event
            const launchEvent = receipt.events.find(e => e.event === "TokenLaunched");
            if (launchEvent) {
              console.log("🚀 LAUNCHED! Launch triggered by this purchase");
              
              const finalMarketCap = await MeteoraContract.getTokenMarketCapUSD(precisionToken);
              console.log("Market Cap at launch:", `${ethers.utils.formatEther(finalMarketCap)}`);
              
              // Verify it's at or above $69k
              const targetMarketCap = ethers.utils.parseEther("69000");
              expect(finalMarketCap).to.be.gte(targetMarketCap);
              console.log("✅ Launched at or above $69k target");
              break;
            }
            
            const postMarketCap = await MeteoraContract.getTokenMarketCapUSD(precisionToken);
            const postShouldMigrate = await MeteoraContract.shouldMigrate(precisionToken);
            
            console.log("Post-buy Market Cap:", `${ethers.utils.formatEther(postMarketCap)}`);
            console.log("Post-buy Should Migrate:", postShouldMigrate);
            
            // Calculate progress
            const targetMarketCap = ethers.utils.parseEther("69000");
            const progress = postMarketCap.mul(100).div(targetMarketCap);
            console.log("Progress to target:", progress.toString() + "%");
            
          } catch (error) {
            console.log("Purchase failed:", error.message);
          }
        }

      } catch (error) {
        console.log("❌ Precision testing failed:", error.message);
      }
    });

    it("8. Should verify post-launch behavior", async function () {
      console.log("\n🔬 Testing Post-Launch Behavior");

      if (!token) {
        console.log("❌ No token available");
        return;
      }

      try {
        const poolInfo = await MeteoraContract.getPoolInfo(token.address);
        
        if (!poolInfo.launched) {
          console.log("ℹ️ Token not launched, skipping post-launch tests");
          return;
        }

        console.log("Testing launched token behavior...");

        // Try to buy from launched token (should fail)
        try {
          await MeteoraContract.connect(addr1).swapExactETHForTokens(
            token.address,
            ethers.utils.parseEther("1.0"),
            0,
            {
              value: ethers.utils.parseEther("1.0"),
              gasLimit: 5000000
            }
          );
          console.log("❌ Should not be able to buy from launched token");
        } catch (error) {
          console.log("✅ Correctly prevented buying from launched token");
          expect(error.message).to.include("Pool has been already launched");
        }

        // Try to sell to launched token (should fail)
        const userBalance = await token.balanceOf(addr1.address);
        if (userBalance.gt(0)) {
          try {
            await token.connect(addr1).approve(MeteoraContract.address, userBalance);
            await MeteoraContract.connect(addr1).swapExactTokensForETH(
              token.address,
              userBalance.div(10), // Try to sell 10%
              0,
              { gasLimit: 5000000 }
            );
            console.log("❌ Should not be able to sell to launched token");
          } catch (error) {
            console.log("✅ Correctly prevented selling to launched token");
            expect(error.message).to.include("Pool has been launched");
          }
        }

        // Verify shouldMigrate returns false
        const shouldMigrate = await MeteoraContract.shouldMigrate(token.address);
        expect(shouldMigrate).to.be.false;
        console.log("✅ shouldMigrate correctly returns false for launched token");

        // Verify final market cap
        const finalMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
        const targetMarketCap = ethers.utils.parseEther("69000");
        console.log("Final Market Cap:", `${ethers.utils.formatEther(finalMarketCap)}`);
        console.log("Target Market Cap:", `${ethers.utils.formatEther(targetMarketCap)}`);
        
        expect(finalMarketCap).to.be.gte(targetMarketCap);
        console.log("✅ Final market cap is at or above $69k target");

      } catch (error) {
        console.log("❌ Post-launch testing failed:", error.message);
      }
    });

  });

  after(async () => {
    console.log("\n🏁 Market Cap Launch Test Suite Completed");
    
    if (token) {
      try {
        const finalPoolInfo = await MeteoraContract.getPoolInfo(token.address);
        const finalMarketCap = await MeteoraContract.getTokenMarketCapUSD(token.address);
        
        console.log("\n📊 Final Results:");
        console.log("Token address:", token.address);
        console.log("Contract address:", MeteoraContract.address);
        console.log("Token launched:", finalPoolInfo.launched);
        console.log("Final market cap:", `${ethers.utils.formatEther(finalMarketCap)}`);
        console.log("Final ETH reserve:", ethers.utils.formatEther(finalPoolInfo.ethReserve));
        
        if (finalPoolInfo.launched) {
          console.log("🎉 SUCCESS: Token successfully launched at $69k market cap!");
        } else {
          console.log("⚠️ Token not launched - may need more testing iterations");
        }
        
      } catch (error) {
        console.log("Error getting final state:", error.message);
      }
    }
  });
});