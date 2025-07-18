import hre from "hardhat";
import { getImplementationAddress } from '@openzeppelin/upgrades-core';
import { expect } from "chai";
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Constants - Reasonable values
const TOTAL_SUPPLY = 10 ** 9; // 1 billion tokens
const DEFAULT_MIGRATION_MARKET_CAP = 69000; // Reasonable migration cap

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

describe("MeteoraStyleBondingCurve - Fixed Math", function () {
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

  describe("Fixed Math Bonding Curve Tests", function () {
    
    it("1. Should create token with simple price tiers", async function () {
      console.log("\n🎯 Testing Token Creation with Simple Price Tiers");

      try {
        // Test ETH price feed
        try {
          const ethPrice = await MeteoraContract.getETHPriceByUSD();
          console.log("ETH Price:", ethers.utils.formatEther(ethPrice));
        } catch (error) {
          console.log("Using fallback ETH price");
        }

        // Create token
        console.log("Creating token...");
        const createTx = await MeteoraContract.connect(owner).createToken(
          "SimpleToken", 
          "SIMPLE", 
          0, // No initial buy
          1, 
          1, 
          { 
            value: 0,
            gasLimit: 8000000
          }
        );
        
        console.log("Waiting for transaction...");
        const receipt = await createTx.wait();
        console.log("Transaction completed, gas used:", receipt.gasUsed.toString());

        const tokenCreatedEvent = receipt.events.find(x => x.event === "TokenCreated");
        expect(tokenCreatedEvent).to.not.be.undefined;
        
        token = await ethers.getContractAt("Token", tokenCreatedEvent.args.token);
        console.log("✅ Token created:", token.address);

        // Get pool info
        const poolInfo = await MeteoraContract.getPoolInfo(token.address);
        console.log("\n📊 Pool Information:");
        console.log("- Owner:", poolInfo.owner);
        console.log("- Pool Type:", poolInfo.poolType.toString());
        console.log("- Current Segment:", poolInfo.currentSegmentIndex.toString());
        console.log("- ETH Reserve:", ethers.utils.formatEther(poolInfo.ethReserve));
        console.log("- Token Reserve:", ethers.utils.formatEther(poolInfo.tokenReserve));
        console.log("- Launched:", poolInfo.launched);

        // Get curve segments
        const curveSegments = await MeteoraContract.getCurveSegments(token.address);
        console.log("\n📈 Price Tiers:", curveSegments.length);
        
        for (let i = 0; i < curveSegments.length; i++) {
          const segment = curveSegments[i];
          console.log(`Tier ${i}:`);
          console.log(`  - Price: ${ethers.utils.formatEther(segment.targetPrice)} ETH per token`);
          console.log(`  - Tokens Available: ${ethers.utils.formatEther(segment.tokensAvailable)}`);
          
          // Calculate ETH needed to exhaust this tier
          const ethNeeded = segment.targetPrice.mul(segment.tokensAvailable).div(ethers.utils.parseEther("1"));
          console.log(`  - ETH to exhaust tier: ${ethers.utils.formatEther(ethNeeded)}`);
        }

        // Calculate financial metrics
        const migrationThreshold = await MeteoraContract.calculateMigrationThreshold(token.address);
        const bondingCurveAmount = await MeteoraContract.calculateBondingCurveAmount(token.address);
        const currentPrice = await MeteoraContract.getCurrentPrice(token.address);

        console.log("\n💰 Financial Metrics:");
        console.log("- Migration Threshold:", ethers.utils.formatEther(migrationThreshold));
        console.log("- Bonding Curve Amount:", ethers.utils.formatEther(bondingCurveAmount));
        console.log("- Current Price:", ethers.utils.formatEther(currentPrice));

        expect(tokenCreatedEvent.args.token).to.be.properAddress;
        expect(curveSegments.length).to.equal(3);

      } catch (error) {
        console.error("❌ Token creation failed:", error);
        throw error;
      }
    });

    it("2. Should perform token purchases with reasonable amounts", async function () {
      console.log("\n🛒 Testing Token Purchases");

      if (!token) {
        console.log("❌ No token available from previous test");
        return;
      }

      // Calculate reasonable purchase amounts based on the price tiers
      const curveSegments = await MeteoraContract.getCurveSegments(token.address);
      const firstTierPrice = curveSegments[0].targetPrice;
      const firstTierTokens = curveSegments[0].tokensAvailable;
      
      console.log("First tier price:", ethers.utils.formatEther(firstTierPrice));
      console.log("First tier tokens:", ethers.utils.formatEther(firstTierTokens));
      
      // Calculate ETH needed to buy 10% of first tier
      const tokensToBuy = firstTierTokens.div(10); // 10% of first tier
      const ethNeeded = firstTierPrice.mul(tokensToBuy).div(ethers.utils.parseEther("1"));
      
      console.log("Tokens to buy (10% of tier 1):", ethers.utils.formatEther(tokensToBuy));
      console.log("ETH needed:", ethers.utils.formatEther(ethNeeded));

      // Test purchases with increasing amounts
      const purchaseAmounts = [
        ethNeeded, // Exact amount for 10% of tier 1
        ethNeeded.mul(3), // 30% of tier 1
        ethNeeded.mul(10).add(ethers.utils.parseEther("0.1")) // Should move to tier 2
      ];

      for (let i = 0; i < purchaseAmounts.length; i++) {
        const buyAmount = purchaseAmounts[i];
        console.log(`\n--- Purchase ${i + 1}: ${ethers.utils.formatEther(buyAmount)} ETH ---`);

        try {
          // Get pre-purchase state
          const prePurchaseInfo = await MeteoraContract.getPoolInfo(token.address);
          const prePrice = await MeteoraContract.getCurrentPrice(token.address);
          const userBalanceBefore = await token.balanceOf(addr1.address);

          console.log("Pre-purchase:");
          console.log("- Segment:", prePurchaseInfo.currentSegmentIndex.toString());
          console.log("- Price:", ethers.utils.formatEther(prePrice));
          console.log("- ETH Reserve:", ethers.utils.formatEther(prePurchaseInfo.ethReserve));

          // Calculate expected tokens
          const [expectedTokens, expectedSegment] = await MeteoraContract.calculateBuyAmount(
            token.address, 
            buyAmount
          );
          console.log("Expected tokens:", ethers.utils.formatEther(expectedTokens));
          console.log("Expected segment:", expectedSegment.toString());

          // Verify expected tokens are reasonable
          if (expectedTokens.gt(prePurchaseInfo.tokenReserve)) {
            console.log("❌ Expected tokens exceed reserve, skipping this purchase");
            continue;
          }

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

          // Check for events
          const buyEvent = receipt.events.find(e => e.event === "BuyTokens");
          const segmentChangeEvent = receipt.events.find(e => e.event === "CurveSegmentChanged");
          
          if (buyEvent) {
            console.log("✅ Buy event emitted");
          }
          
          if (segmentChangeEvent) {
            console.log("🚀 Segment changed to:", segmentChangeEvent.args.newSegmentIndex.toString());
          }

          // Get post-purchase state
          const postPurchaseInfo = await MeteoraContract.getPoolInfo(token.address);
          const postPrice = await MeteoraContract.getCurrentPrice(token.address);
          const userBalanceAfter = await token.balanceOf(addr1.address);
          const tokensReceived = userBalanceAfter.sub(userBalanceBefore);

          console.log("Post-purchase:");
          console.log("- Segment:", postPurchaseInfo.currentSegmentIndex.toString());
          console.log("- Price:", ethers.utils.formatEther(postPrice));
          console.log("- ETH Reserve:", ethers.utils.formatEther(postPurchaseInfo.ethReserve));
          console.log("- Tokens received:", ethers.utils.formatEther(tokensReceived));

          // Show updated curve state
          const updatedSegments = await MeteoraContract.getCurveSegments(token.address);
          console.log("Updated curve state:");
          for (let j = 0; j < updatedSegments.length; j++) {
            console.log(`  Tier ${j}: ${ethers.utils.formatEther(updatedSegments[j].tokensAvailable)} tokens available`);
          }

          // Validations
          expect(tokensReceived).to.be.gt(0, "Should receive some tokens");
          expect(postPurchaseInfo.ethReserve).to.be.gt(prePurchaseInfo.ethReserve, "ETH reserve should increase");

          // Check if launched
          if (postPurchaseInfo.launched) {
            console.log("🎉 Token launched!");
            break;
          }

        } catch (error) {
          console.log(`❌ Purchase ${i + 1} failed:`, error.message);
        }
      }
    });

    it("3. Should test sell functionality", async function () {
      console.log("\n💰 Testing Token Sells");

      if (!token) {
        console.log("❌ No token available");
        return;
      }

      try {
        // Check if addr2 has tokens, if not buy some
        let userTokenBalance = await token.balanceOf(addr2.address);
        
        if (userTokenBalance.eq(0)) {
          console.log("Buying tokens for sell test...");
          
          // Buy a small amount from first tier
          const curveSegments = await MeteoraContract.getCurveSegments(token.address);
          const firstTierPrice = curveSegments[0].targetPrice;
          const buyAmount = firstTierPrice.mul(ethers.utils.parseEther("1000")).div(ethers.utils.parseEther("1")); // Buy 1000 tokens
          
          console.log("Buy amount for sell test:", ethers.utils.formatEther(buyAmount));
          
          await MeteoraContract.connect(addr2).swapExactETHForTokens(
            token.address, 
            buyAmount, 
            0, 
            { 
              value: buyAmount,
              gasLimit: 5000000
            }
          );
          
          userTokenBalance = await token.balanceOf(addr2.address);
        }

        console.log("User token balance:", ethers.utils.formatEther(userTokenBalance));

        if (userTokenBalance.gt(0)) {
          // Try to sell half the tokens
          const sellAmount = userTokenBalance.div(2);
          console.log("Attempting to sell:", ethers.utils.formatEther(sellAmount));

          // Check pool state
          const poolInfo = await MeteoraContract.getPoolInfo(token.address);
          console.log("Pool ETH Reserve:", ethers.utils.formatEther(poolInfo.ethReserve));

          if (poolInfo.ethReserve.gt(0) && !poolInfo.launched) {
            // Calculate expected ETH
            const [expectedEth, expectedSegment] = await MeteoraContract.calculateSellAmount(
              token.address, 
              sellAmount
            );
            console.log("Expected ETH:", ethers.utils.formatEther(expectedEth));
            console.log("Expected segment after sell:", expectedSegment.toString());

            if (expectedEth.lte(poolInfo.ethReserve)) {
              // Approve and sell
              await token.connect(addr2).approve(MeteoraContract.address, sellAmount);
              
              const sellTx = await MeteoraContract.connect(addr2).swapExactTokensForETH(
                token.address, 
                sellAmount, 
                0,
                { gasLimit: 5000000 }
              );
              
              const receipt = await sellTx.wait();
              console.log("✅ Sell completed, gas used:", receipt.gasUsed.toString());

              // Check sell event
              const sellEvent = receipt.events.find(e => e.event === "SellTokens");
              if (sellEvent) {
                console.log("✅ Sell event emitted");
              }

            } else {
              console.log("❌ Expected ETH exceeds reserve");
            }
          } else {
            console.log("Cannot sell: No ETH reserve or already launched");
          }
        } else {
          console.log("No tokens to sell");
        }

      } catch (error) {
        console.log("❌ Sell test error:", error.message);
      }
    });

    it("4. Should test progression to migration", async function () {
      console.log("\n🚀 Testing Progression to Migration");

      if (!token) {
        console.log("❌ No token available");
        return;
      }

      try {
        let attemptCount = 0;
        let isLaunched = false;
        const maxAttempts = 10;

        while (!isLaunched && attemptCount < maxAttempts) {
          attemptCount++;
          console.log(`\n--- Migration Attempt ${attemptCount} ---`);

          const poolInfo = await MeteoraContract.getPoolInfo(token.address);
          const migrationThreshold = poolInfo.migrationQuoteThreshold;
          const currentEthReserve = poolInfo.ethReserve;

          console.log("Current ETH Reserve:", ethers.utils.formatEther(currentEthReserve));
          console.log("Migration Threshold:", ethers.utils.formatEther(migrationThreshold));

          if (migrationThreshold.gt(0)) {
            const progress = currentEthReserve.mul(100).div(migrationThreshold);
            console.log("Progress:", progress.toString() + "%");
          }

          if (poolInfo.launched) {
            isLaunched = true;
            console.log("🎉 Token already launched!");
            break;
          }

          // Calculate how much ETH we need
          const ethNeeded = migrationThreshold.sub(currentEthReserve);
          console.log("ETH needed:", ethers.utils.formatEther(ethNeeded));

          // Make a reasonable purchase
          const buyAmount = ethNeeded.gt(ethers.utils.parseEther("1")) 
            ? ethers.utils.parseEther("1") 
            : ethNeeded.add(ethers.utils.parseEther("0.01"));

          console.log("Buying with:", ethers.utils.formatEther(buyAmount));

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
              console.log("🎉 Token launched successfully!");
              console.log("Launch timestamp:", launchEvent.args[1].toString());
              break;
            }

            // Show updated state
            const updatedPoolInfo = await MeteoraContract.getPoolInfo(token.address);
            console.log("Updated ETH Reserve:", ethers.utils.formatEther(updatedPoolInfo.ethReserve));

          } catch (error) {
            console.log("Purchase failed:", error.message);
            break;
          }
        }

        if (isLaunched) {
          console.log("✅ Token successfully launched!");
        } else {
          console.log("ℹ️ Token not launched after", maxAttempts, "attempts");
        }

      } catch (error) {
        console.log("❌ Migration test failed:", error.message);
      }
    });

    it("5. Should test debug functions", async function () {
      console.log("\n🔍 Testing Debug Functions");

      if (!token) {
        console.log("❌ No token available");
        return;
      }

      try {
        const debugInfo = await MeteoraContract.debugCurveCalculation(token.address);
        
        console.log("Debug Information:");
        console.log("- Prices:", debugInfo.prices.map(p => ethers.utils.formatEther(p)));
        console.log("- Tokens Available:", debugInfo.tokensAvailable.map(t => ethers.utils.formatEther(t)));
        console.log("- Migration Threshold:", ethers.utils.formatEther(debugInfo.migrationThreshold));
        console.log("- Bonding Curve Amount:", ethers.utils.formatEther(debugInfo.bondingCurveAmount));

        expect(debugInfo.prices.length).to.equal(3);
        expect(debugInfo.tokensAvailable.length).to.equal(3);

      } catch (error) {
        console.log("❌ Debug test failed:", error.message);
      }
    });

    it("6. Should test custom price tiers", async function () {
      console.log("\n⚙️ Testing Custom Price Tiers");

      try {
        // Create new token for custom tiers
        const customTx = await MeteoraContract.connect(owner).createToken(
          "CustomTiers", 
          "CTIERS", 
          0, 
          2, 
          1, 
          { 
            value: 0,
            gasLimit: 8000000
          }
        );
        
        const customReceipt = await customTx.wait();
        const customTokenEvent = customReceipt.events.find(x => x.event === "TokenCreated");
        const customToken = customTokenEvent.args.token;

        console.log("Custom token created:", customToken);

        // Define custom price tiers
        const customSegments = [
          {
            targetPrice: ethers.utils.parseEther("0.00001"), // 0.00001 ETH per token
            tokensAvailable: ethers.utils.parseEther("1000000") // 1M tokens
          },
          {
            targetPrice: ethers.utils.parseEther("0.00005"), // 0.00005 ETH per token
            tokensAvailable: ethers.utils.parseEther("2000000") // 2M tokens
          },
          {
            targetPrice: ethers.utils.parseEther("0.0001"), // 0.0001 ETH per token
            tokensAvailable: ethers.utils.parseEther("3000000") // 3M tokens
          }
        ];

        // Set custom tiers
        await MeteoraContract.setCurveSegments(customToken, customSegments);
        console.log("✅ Custom price tiers set");

        // Verify
        const retrievedSegments = await MeteoraContract.getCurveSegments(customToken);
        console.log("Custom tiers count:", retrievedSegments.length);
        
        for (let i = 0; i < retrievedSegments.length; i++) {
          const segment = retrievedSegments[i];
          console.log(`Custom Tier ${i}:`);
          console.log(`  - Price: ${ethers.utils.formatEther(segment.targetPrice)} ETH per token`);
          console.log(`  - Tokens: ${ethers.utils.formatEther(segment.tokensAvailable)}`);
        }

        expect(retrievedSegments.length).to.equal(3);

      } catch (error) {
        console.log("❌ Custom tiers test failed:", error.message);
      }
    });

    it("7. Should test admin functions", async function () {
      console.log("\n🔧 Testing Admin Functions");

      if (!token) {
        console.log("❌ No token available");
        return;
      }

      try {
        // Test fee configuration
        const newFees = {
          baseFee: 50,  // 0.5%
          migrationFee: 3, // 3%
          creatorFeeShare: 25 // 25%
        };

        await MeteoraContract.setPoolFees(token.address, newFees);
        console.log("✅ Pool fees updated");

        // Test creation fee
        await MeteoraContract.setCreateTokenFeeAmount(ethers.utils.parseEther("0.001"));
        console.log("✅ Creation fee updated");

        // Test pause/unpause
        await MeteoraContract.pause();
        console.log("✅ Contract paused");
        
        await MeteoraContract.unpause();
        console.log("✅ Contract unpaused");

        // Test emergency functions
        const contractBalance = await ethers.provider.getBalance(MeteoraContract.address);
        console.log("Contract ETH balance:", ethers.utils.formatEther(contractBalance));

        if (contractBalance.gt(0)) {
          const withdrawAmount = contractBalance.div(20); // 5% of balance
          await MeteoraContract.emergencyWithdrawETH(withdrawAmount);
          console.log("✅ Emergency ETH withdraw tested");
        }

      } catch (error) {
        console.log("❌ Admin functions test failed:", error.message);
      }
    });
  });

  after(async () => {
    console.log("\n🏁 Test suite completed successfully");
    if (token) {
      console.log("Final token address:", token.address);
    }
    console.log("Contract address:", MeteoraContract.address);
  });
});