
// scripts/listenPastEvents.js
const { ethers } = require("hardhat");
const fs = require("fs");
async function main() {
    // Contract details
    const CONTRACT_ADDRESS = "0x034dE400A1adF5E215D75b04a095F10786687b9f"; // Replace with actual address
    const CONTRACT_ABI = [
        // Example ABI - replace with your contract's ABI
        "event Migrated(address indexed from, address indexed token, address indexed newToken)",
        // Add more events as needed
    ];

    // Get provider and contract instance
    const provider = ethers.provider;
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    console.log("🔍 Fetching past events...");
    console.log(`Contract: ${CONTRACT_ADDRESS}`);

    try {
        // Method 1: Get all Transfer events from the last 1000 blocks
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = 22798511; // Replace with your desired starting block number

        // console.log(`\n📊 Scanning blocks ${fromBlock} to ${currentBlock}`);

        // // Query Transfer events
        // const transferFilter = contract.filters.Migrated();
        // const transferEvents = await contract.queryFilter(transferFilter, fromBlock, currentBlock);

        // console.log(`\n🔄 Found ${transferEvents.length} Transfer events:`);
        // transferEvents.forEach((event, index) => {
        //   console.log(`${index + 1}. Block: ${event.blockNumber}`);
        //   console.log(`   From: ${event.args.from}`);
        //   console.log(`   To: ${event.args.to}`);
        //   console.log(`   Value: ${ethers.formatEther(event.args.value)} ETH`);
        //   console.log(`   Tx: ${event.transactionHash}\n`);
        // });

        // Method 2: Get events with specific filters
        console.log("\n🎯 Filtering events for specific address...");
        const filteredTransfers = contract.filters.Migrated(); // From specific address
        const specificEvents = await contract.queryFilter(filteredTransfers, fromBlock, currentBlock);

        console.log(specificEvents);
        for (const event of specificEvents) {
            console.log(`\n📝 Event: ${event}`);
            const { from, token, newToken } = event.args;

            fs.appendFileSync('migrate.sql', `UPDATE tokens SET tokenAddress="${newToken}" WHERE tokenAddress="${token}";\n`);
            console.log(`Updated token ${token} to new address ${newToken}`);
            fs.appendFileSync('migrate.sql', `UPDATE holders SET tokenAddress="${newToken}" WHERE tokenAddress="${token}";\n`);
            fs.appendFileSync('migrate.sql', `UPDATE trades SET tokenAddress="${newToken}" WHERE tokenAddress="${token}";\n`);
        }

        // fs.writeFileSync('migrate.sql', tokens.flatMap(([t1, t2]) => [
        //     `UPDATE holders SET tokenAddress="${t2}" WHERE tokenAddress="${t1}"`,
        //     `UPDATE trades SET tokenAddress="${t2}" WHERE tokenAddress="${t1}"`,
        //     `UPDATE tokens SET tokenAddress="${t2}" WHERE tokenAddress="${t1}"`,
        // ]).join(";\n"))


        // Method 3: Get events by specific block range with pagination
        console.log("\n📚 Fetching events with pagination...");
        await fetchEventsPaginated(contract, fromBlock, currentBlock);

    } catch (error) {
        console.error("❌ Error fetching events:", error.message);
    }
}

async function fetchEventsPaginated(contract, startBlock, endBlock, chunkSize = 100) {
    console.log(`Fetching events in chunks of ${chunkSize} blocks...`);

    for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += chunkSize) {
        const toBlock = Math.min(fromBlock + chunkSize - 1, endBlock);

        try {
            const events = await contract.queryFilter("Transfer", fromBlock, toBlock);
            console.log(`Blocks ${fromBlock}-${toBlock}: ${events.length} events`);

            // Process events here
            events.forEach(event => {
                // Process individual event
                console.log(`  📝 ${event.blockNumber}: ${event.transactionHash}`);
            });

        } catch (error) {
            console.error(`Error fetching blocks ${fromBlock}-${toBlock}:`, error.message);
        }
    }
}

// Alternative function for listening to multiple event types
async function listenMultipleEvents() {
    const CONTRACT_ADDRESS = "0x1234567890123456789012345678901234567890";
    const CONTRACT_ABI = [
        "event Transfer(address indexed from, address indexed to, uint256 value)",
        "event Approval(address indexed owner, address indexed spender, uint256 value)",
        "event Mint(address indexed to, uint256 amount)",
    ];

    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, ethers.provider);
    const currentBlock = await ethers.provider.getBlockNumber();
    const fromBlock = currentBlock - 500;

    console.log("\n🎪 Fetching multiple event types...");

    // Get all events of different types
    const eventTypes = ["Transfer", "Approval", "Mint"];

    for (const eventType of eventTypes) {
        try {
            const filter = contract.filters[eventType]();
            const events = await contract.queryFilter(filter, fromBlock, currentBlock);

            console.log(`\n${eventType} Events: ${events.length}`);
            events.slice(0, 3).forEach((event, i) => { // Show first 3 events
                console.log(`  ${i + 1}. Block ${event.blockNumber}: ${event.transactionHash}`);
                console.log(`     Args:`, event.args);
            });

        } catch (error) {
            console.log(`No ${eventType} events found or error:`, error.message);
        }
    }
}

// Run the script
if (require.main === module) {
    main()
        .then(() => {
            console.log("\n✅ Script completed successfully");
            process.exit(0);
        })
        .catch((error) => {
            console.error("❌ Script failed:", error);
            process.exit(1);
        });
}

module.exports = { main, fetchEventsPaginated, listenMultipleEvents };

// ===================================

// package.json dependencies needed:
/*
{
  "devDependencies": {
    "@nomicfoundation/hardhat-toolbox": "^3.0.0",
    "hardhat": "^2.17.0",
    "dotenv": "^16.0.0"
  }
}
*/

// .env file example:
/*
MAINNET_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/your-api-key
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-api-key
PRIVATE_KEY=your-private-key-here
*/