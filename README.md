# Forgepad.finance - Multi-Chain Token Launchpad

A comprehensive multi-chain token launchpad supporting Ethereum, Base, BSC, and Solana networks with dynamic bonding curves and real-time trading.

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
- **Multi-chain Support**: Ethereum, Base, BSC, Solana

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
ETHEREUM_RPC_URL=your_ethereum_rpc
BASE_RPC_URL=your_base_rpc
BSC_RPC_URL=your_bsc_rpc
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
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

### EVM Chains
- **Ethereum Mainnet**: Native ETH trading
- **Base**: Layer 2 scaling solution
- **BSC**: Binance Smart Chain with BNB

### Solana
- **Mainnet Beta**: SPL token support with Meteora DBC
- **Dynamic Bonding Curves**: Automated price discovery
- **Real-time Events**: WebSocket-based updates

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
