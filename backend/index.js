const express = require("express");
const http = require('http');
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dotenv = require('dotenv');

dotenv.config();

const app = express();
// const axios = require('axios');
// const request = require('request')
// const { twitterAuthClient } = require('./app/config/twitter.config')

// Parse allowed origins from env (comma-separated) or fall back to restrictive default
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['https://forgepad.finance', 'https://www.forgepad.finance'];

const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: allowedOrigins,
  }
}); // Attach socket.io to the server

var corsOptions = {
  origin: allowedOrigins
};

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting for API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/tokens', apiLimiter);
app.use('/users', apiLimiter);
app.use('/trades', apiLimiter);

app.use(cors(corsOptions));
// parse requests of content-type - application/json
app.use(express.json());
// parse requests of content-type - application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// app.use('/', express.static('out'))
app.use('/uploads', express.static('uploads'))

// const usersTable = db.users;

// Websocket communication (commented out to avoid database dependency)
// require("./app/controllers/websocket")(io);
// const tradesController = require("./app/controllers/trades.controller");
const { CHAINS } = require("./app/config/web3.config");
//const usersController = require("./app/controllers/users.controller");
// const e = require("express");

// Twitter OAuth routes removed - see git history if needed

// app.get('/trades/recent', tradesController.getLatestTrades); // all trades on token address
app.get('/config', (req, res) => {
  res.json({
    chains: CHAINS
  })
});

// app.get('/logo/:uri', function (req, res) {
//   request.get(`https://coinhublogos.9inch.io/${req.params.uri}`).pipe(res)
// })

// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Routes
require("./app/routes/tokens.routes")(app);
require("./app/routes/chats.routes")(app);
require("./app/routes/trades.routes")(app);
require("./app/routes/users.routes")(app);

// Listeners
require("./app/listeners/tokens.listener")(io);

// Global error handler middleware (must be after all routes)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// set port, listen for requests
// eslint-disable-next-line no-undef
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful shutdown handling
function gracefulShutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    io.close(() => {
      console.log('Socket.io connections closed.');
      process.exit(0);
    });
  });
  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));