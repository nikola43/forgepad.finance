const { Client, auth } = require("twitter-api-sdk");

const twitterAuthClient = new auth.OAuth2User({
    client_id: process.env.TWITTER_CLIENT_ID || '',
    client_secret: process.env.TWITTER_CLIENT_SECRET || '',
    callback: process.env.TWITTER_CALLBACK_URL || '',
    scopes: ["tweet.read", "users.read"],
});

const twitterClient = new Client(twitterAuthClient);
const twitterState = "my-state";

module.exports = {
    twitterAuthClient,
    twitterClient,
    twitterState
};