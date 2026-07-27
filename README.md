# Forgepad.finance - Multi-Chain Token Launchpad

A multi-chain token launchpad running on **BNB Smart Chain** and **Robinhood Chain**, with
dynamic bonding curves, Chainlink-priced graduation, and real-time trading.

## 🚀 Recent Improvements & Bug Fixes

### Security Fixes ✅
- **CRITICAL**: Removed hardcoded private keys from source code
- **HIGH**: Implemented proper environment variable management
- **HIGH**: Added comprehensive input validation and sanitization
- **MEDIUM**: Fixed potential SQL injection vulnerabilities
- **MEDIUM**: Improved error handling to prevent information leakage

### Solana Integration Fixes ✅
- **Fixed**: Meteora Dynamic Bonding Curve integration
- **Improved**: Solana transaction parsing and event handling
- **Added**: Proper WebSocket connection management with reconnection logic
- **Enhanced**: Token creation and swap event processing
- **Fixed**: TypeScript errors and missing dependencies

### Code Quality Improvements ✅
- **Refactored**: Event listener architecture with better error handling
- **Removed**: Unused imports and commented code
- **Standardized**: Error response formats across API endpoints
- **Added**: Comprehensive logging for debugging
- **Improved**: Input validation and data sanitization

### Performance Optimizations ✅
- **Enhanced**: Database query efficiency
- **Improved**: WebSocket connection pooling
- **Added**: Proper connection cleanup and memory management
- **Optimized**: Event processing pipeline

## 📁 Project Structure

```
forgepad.finance/
├── backend/           # Node.js/Express API server
├── frontend/          # Next.js React application
├── contracts/         # Ethereum smart contracts (Hardhat)
├── mbc/              # Meteora Bonding Curve integration
└── README.md         # This file
```

## 🛠 Components

### Backend (Node.js/Express)
- **API Server**: RESTful API for token management
- **WebSocket**: Real-time event streaming
- **Database**: MySQL with Sequelize ORM
- **Multi-chain Support**: BNB Smart Chain (56), Robinhood Chain (4663)

### Frontend (Next.js/React)
- **Multi-chain Wallet**: Support for EVM and Solana wallets
- **Real-time UI**: Live token data and trading interface
- **Responsive Design**: Mobile-first approach

### Smart Contracts (Solidity)
- **Token Factory**: Automated token deployment
- **Bonding Curves**: Dynamic pricing mechanisms
- **Liquidity Management**: Automated LP creation

### Solana Integration (MBC)
- **Meteora DBC**: Dynamic bonding curve implementation
- **SPL Token Support**: Native Solana token creation
- **Transaction Processing**: Real-time event handling

## 🔧 Setup Instructions

### Prerequisites
- Node.js 18+
- MySQL 8.0+
- Git

### Environment Configuration

#### Backend (.env)
```bash
# Database
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=forgepad

# API Keys
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret

# Network RPCs
BSC_RPC_URL=your_bsc_rpc                 # chain 56
ROBINHOOD_RPC_URL=your_robinhood_rpc     # chain 4663
```

#### MBC (.env)
```bash
# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_base58_encoded_private_key
SOLANA_QUOTE_MINT=So11111111111111111111111111111111111111112
```

#### Frontend (.env.local)
```bash
NEXT_PUBLIC_PROJECT_ID=your_reown_project_id
NEXT_PUBLIC_API_ENDPOINT=http://localhost:5000
```

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/truth4you/forgepad.finance.git
cd forgepad.finance
```

2. **Install Backend Dependencies**
```bash
cd backend
npm install
```

3. **Install Frontend Dependencies**
```bash
cd ../frontend
npm install
```

4. **Install MBC Dependencies**
```bash
cd ../mbc
npm install
```

5. **Install Contract Dependencies**
```bash
cd ../contracts
npm install
```

### Database Setup

1. **Create MySQL Database**
```sql
CREATE DATABASE forgepad;
```

2. **Run Migrations**
```bash
cd backend
npm run migrate
```

### Running the Application

1. **Start Backend Server**
```bash
cd backend
npm start
```

2. **Start Frontend Development Server**
```bash
cd frontend
npm run dev
```

3. **Deploy Smart Contracts** (if needed)
```bash
cd contracts
npm run deploy
```

## 🔗 Supported Networks

Both chains run the same contracts and the same economics: 1B token supply, a
$30,000 graduation market cap priced off a Chainlink feed, and a 1% trade fee
(0.5% treasury / 0.3% leaderboard / 0.2% creator).

| | BNB Smart Chain | Robinhood Chain |
|---|---|---|
| Chain ID | 56 | 4663 |
| Gas token | BNB | ETH |
| Explorer | [bscscan.com](https://bscscan.com) | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |
| DEX at graduation | PancakeSwap V2 / V3 | V2 / V3 (`0x89e5DB8B…`, `0x1f7d7550…`) |
| Chainlink feed | BNB/USD | ETH/USD |
| Feed staleness window | 1 hour | 24 hours — an Arbitrum Orbit L2, so feed timestamps originate on L1 and lag |

### Deployed contracts

**BNB Smart Chain (56)**

| Contract | Address |
|---|---|
| Fyuz (proxy) | `0xF6B950BB390E046B5e778Cf840Fc800F33E8898b` |
| FyuzLiquidityManager (proxy) | `0xf75cFddBbC4762dBb58E6BADA09c1E01108F3c2a` |
| Distributor (live) | `0x661a79fBa6b2E3bCDEFAF6A7260bF1826ed90C33` |
| Distributor (deployed, not yet receiving fees) | `0x5a0DEE7A4074912A16E40230C59E9a7835354845` |
| CREPoster | `0x980ff7370835FAc49Cf5af4Bf11476C6Bd3b0183` |

`Fyuz.distributorAddress()` still points at the first Distributor. The
replacement above is deployed, verified and wired to CREPoster, but only starts
receiving the fee stream once the Safe calls `setDistributorAddress` — check
`Fyuz.distributorAddress()` on-chain for the authoritative answer.

**Robinhood Chain (4663)**

| Contract | Address |
|---|---|
| Fyuz (proxy) | `0x750F04fE9A9a13Df768B5F6C94bfCf98A34fe96B` |
| LiquidityManager (proxy) | `0x661a79fBa6b2E3bCDEFAF6A7260bF1826ed90C33` |

Both Fyuz proxies and their ProxyAdmins are owned by the same Gnosis Safe.

**Leaderboard payouts are BNB Smart Chain only for now.** The 0.3% leaderboard
fee stream on Robinhood Chain currently goes to an EOA because no Distributor is
deployed there; on BSC it reaches the Distributor above, which pays 90% pro-rata
to the top 100 and 10% to one Chainlink-VRF-picked participant per round.
Rounds are driven end-to-end by a Chainlink CRE workflow (`cre/`) — Chainlink
Automation is not used, as v2.1 sunsets 2026-07-31.

`mbc/` holds a legacy Solana (Meteora DBC) package. It is not wired into the
Rust backend and is not part of either deployment.

## 🚨 Security Considerations

### Environment Variables
- **Never commit** `.env` files to version control
- **Use strong** private keys and API secrets
- **Rotate keys** regularly in production

### API Security
- **Input validation** on all endpoints
- **Rate limiting** implemented
- **CORS** properly configured
- **Error handling** prevents information leakage

### Smart Contract Security
- **Audited contracts** recommended for production
- **Multi-signature** wallets for admin functions
- **Timelock** mechanisms for critical updates

## 📊 Monitoring & Logging

### Backend Logging
- **Structured logging** with timestamps
- **Error tracking** with stack traces
- **Performance metrics** for API endpoints
- **Database query** optimization logs

### Frontend Monitoring
- **User interaction** tracking
- **Error boundary** implementation
- **Performance** monitoring with Web Vitals

## 🧪 Testing

### Backend Tests
```bash
cd backend
npm test
```

### Frontend Tests
```bash
cd frontend
npm test
```

### Contract Tests
```bash
cd contracts
npm test
```

## 📈 Performance Optimizations

### Database
- **Indexed queries** for faster lookups
- **Connection pooling** for better resource management
- **Query optimization** to reduce N+1 problems

### WebSocket
- **Connection management** with automatic reconnection
- **Event batching** to reduce message frequency
- **Memory leak prevention** with proper cleanup

### Frontend
- **Code splitting** for faster initial loads
- **Image optimization** with Next.js
- **Caching strategies** for API responses

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch
3. **Commit** your changes
4. **Push** to the branch
5. **Create** a Pull Request

### Code Standards
- **ESLint** configuration provided
- **Prettier** for code formatting
- **TypeScript** for type safety
- **Conventional commits** for clear history

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- **GitHub Issues**: Bug reports and feature requests
- **Telegram**: [@forgepad](https://t.me/forgepad)
- **Twitter**: [@forgepad](https://x.com/forgepad)
- **Website**: [forgepad.finance](https://forgepad.finance)

## 🔄 Changelog

### v2.0.0 (Latest)
- ✅ Fixed critical security vulnerabilities
- ✅ Improved Solana integration with Meteora DBC
- ✅ Enhanced error handling and logging
- ✅ Optimized database queries and WebSocket connections
- ✅ Added comprehensive input validation
- ✅ Removed hardcoded secrets and improved environment management

### v1.0.0
- 🚀 Initial release with multi-chain support
- 🎯 Basic token creation and trading functionality
- 📱 Responsive web interface
- 🔗 EVM chain integration (Ethereum, Base, BSC)
- 🌟 Initial Solana support

---

**Built with ❤️ by the Forgepad Team**
