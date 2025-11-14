const express = require("express");
const http = require('http');
const cors = require("cors");
const dotenv = require('dotenv');
const app = express();
// const axios = require('axios');
// const request = require('request')
// const { twitterAuthClient } = require('./app/config/twitter.config')

dotenv.config();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: '*',
  }
}); // Attach socket.io to the server

var corsOptions = {
  origin: "*"
};

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

// app.get("/login", async function (req, res) {
//   const authUrl = authClient.generateAuthURL({
//     state: STATE,
//     code_challenge_method: "s256",
//   });
//   console.log(authUrl);
//   res.redirect(authUrl);
// });

// app.get("/revoke", async function (req, res) {
//   try {
//     const response = await authClient.revokeAccessToken();
//     res.send(response);
//   } catch (error) {
//     console.log(error);
//   }
// });

// app.get("/fakelogin/:address", async function (req, res) {
//   const user = {
//       address: req.params.address,
//       username: "Fake",
//   }
//   io.emit('message', JSON.stringify({
//       type: 'twitter_login',
//       address: req.params.address,
//       user
//   }))
//   res.end()
// })

// app.get("/callback", async function (req, res) {

//   let accessToken = "";
//   try {
//     const { code, state: address } = req.query;
//     // if (state !== twitterState) 
//     //   return res.status(500).send("State isn't matching");
//     accessToken = (await twitterAuthClient.requestAccessToken(code)).token
//       .access_token;
//     console.log("AccessToken: " + JSON.stringify(accessToken));


//     const response = await axios.get("https://api.twitter.com/2/users/me", {
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${accessToken}`,
//       },
//     });
//     //console.log(response.data);
//     const { id, name, username } = response.data.data;
//     console.log({
//       id, name, username
//     })

//     console.log({
//       id, name, username, address
//     })

//     // Specify the fields you want to include in the response
//     const params = {
//       'user.fields': 'profile_image_url,verified,verified_type'  // Add any other fields you need
//     };
//     const profilePicResponse = await axios.get("https://api.twitter.com/2/users/by/username/" + username, {
//       params,
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${accessToken}`,
//       },
//     }).then((res) => {
//       return res;
//     }).catch((err) => {
//       console.log(err);
//     });

//     console.log({
//       profilePicResponse: profilePicResponse.data.data,
//       profilePicResponsePic: profilePicResponse.data.data.profile_image_url
//     })

//     const userByAddress = await usersTable.findOne({
//       where: {
//         address
//       }
//     });

//     const userByTwitter = await usersTable.findOne({
//       where: {
//         twitter_id: id
//       }
//     });

//     if (userByTwitter) {
//       await userByTwitter.update({
//         twitter_verified: profilePicResponse.data.data.verified,
//         twitter_username: username,
//         twitter_name: name,
//         twitter_access: accessToken,
//         twitter_profile_picture: profilePicResponse.data.data.profile_image_url
//       });
//     } else if (userByAddress) {
//       await userByAddress.update({
//         twitter_verified: profilePicResponse.data.data.verified,
//         twitter_id: id,
//         twitter_username: username,
//         twitter_name: name,
//         twitter_access: accessToken,
//         twitter_profile_picture: profilePicResponse.data.data.profile_image_url
//       });
//     } else {
//       await usersTable.create({
//         twitter_verified: profilePicResponse.data.data.verified,
//         address,
//         username,
//         twitter_id: id,
//         twitter_username: username,
//         twitter_name: name,
//         twitter_access: accessToken,
//         twitter_profile_picture: profilePicResponse.data.data.profile_image_url
//       });
//     }

//     const user = await usersTable.findOne({
//       where: {
//         twitter_id: id
//       }
//     });

//     io.emit('message', JSON.stringify({
//       type: 'twitter_login',
//       address,
//       user
//     }))

//     res.send(`
//       <html>
//         <body>
//           <p>You have been authenticated with this platform. You can close the window now.</p>
//           <script>
//             // Close the window after a delay
//             setTimeout(() => {
//               window.close();
//             }, 3000); // 3 seconds delay
//           </script>
//         </body>
//       </html>
//     `);
//   } catch (error) {
//     console.log(error);
//   }

// })

// app.get('/trades/recent', tradesController.getLatestTrades); // all trades on token address
app.get('/config', (req, res) => {
  res.json({
    chains: CHAINS
  })
});

// app.get('/logo/:uri', function (req, res) {
//   request.get(`https://coinhublogos.9inch.io/${req.params.uri}`).pipe(res)
// })

// Routes
require("./app/routes/tokens.routes")(app);
// require("./app/routes/chats.routes")(app);
require("./app/routes/trades.routes")(app);
require("./app/routes/users.routes")(app);

// Listeners
require("./app/listeners/tokens.listener")(io);

// set port, listen for requests
// eslint-disable-next-line no-undef
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));