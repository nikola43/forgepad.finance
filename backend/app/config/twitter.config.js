const { Client, auth } = require("twitter-api-sdk");

const twitterAuthClient = new auth.OAuth2User({
    // client_id: "ZURHVmZhM0FxYm0yWDZBNTZ6c2g6MTpjaQ",
    // client_secret: "489DpfNasqqX5m3UnLSGyrE5968gCBB8EufXavIMKWGvxXujhY",
    client_id: "VkkzZmlkU0pLNXY5SHJKdjFoTGI6MTpjaQ",
    client_secret: "XGRy7bBbwUqalUqH-6icPJgK0Z8Uql4h7ZHc4Cg7e6Seok4Cjl",
    callback: "https://apipumpfork.9inch.io/callback",
    scopes: ["tweet.read", "users.read"],
});

const twitterClient = new Client(twitterAuthClient);
const twitterState = "my-state";

module.exports = {
    twitterAuthClient,
    twitterClient,
    twitterState
};