const dbConfig = require("../config/db.config.js");

const Sequelize = require("sequelize");
console.log({
  dbConfig
})
const sequelize = new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
  host: dbConfig.HOST,
  dialect: dbConfig.dialect,
  // operatorsAliases: false,
  logging: false,
  // logging: console.log,
  pool: {
    max: dbConfig.pool.max,
    min: dbConfig.pool.min,
    acquire: dbConfig.pool.acquire,
    idle: dbConfig.pool.idle
  },
  dialectOptions: {
    connectTimeout: 30000
  },
  port: dbConfig.PORT,
  charset: 'utf8mb4',
});

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.tokens = require("./tokens.model.js")(sequelize, Sequelize);
db.trades = require("./trades.model.js")(sequelize, Sequelize);
db.holders = require("./holders.model.js")(sequelize, Sequelize);
db.chats = require("./chats.model.js")(sequelize, Sequelize);
db.users = require("./users.model.js")(sequelize, Sequelize);
db.followers = require("./followers.model.js")(sequelize, Sequelize);
db.followees = require("./followees.model.js")(sequelize, Sequelize);
db.requests = require("./requests.model.js")(sequelize, Sequelize);
db.indexing = require("./indexing.model.js")(sequelize, Sequelize);
db.referrals = require("./referrals.model.js")(sequelize, Sequelize);
db.referralInfo = require("./referral_info.model.js")(sequelize, Sequelize);
db.kings = require("./kings.model.js")(sequelize, Sequelize);
db.admins = require("./admins.model.js")(sequelize, Sequelize);

module.exports = db;
