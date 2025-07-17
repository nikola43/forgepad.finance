// const verifyToken = require("../middleware/index.js");

module.exports = app => {
  const usersController = require("../controllers/users.controller.js");
  const router = require("express").Router();

  // router.get('/', usersController.getUserInfo); // get user info
  // router.get('/ranking', usersController.getRanking); // get user info
  // router.get('/followings/:address', usersController.getFollowings); // get user info
  // router.get('/profile/:address', usersController.getUserProfile); // get user info
  // router.get('/balance/:id', usersController.getBalance); // get user info
  // router.post('/', usersController.createUser); // create user
  // router.post('/follow/:address', usersController.followUser); 
  // router.post('/unfollow/:address', usersController.unfollowUser); 
  // router.post('/update', usersController.updateUsername);
  // router.get('/login/:address', usersController.loginWithTwitter); 
  // router.get('/referral', usersController.addRefferal); 
  //router.get('/loginWithTwitterCallback', usersController.loginWithTwitterCallback); // create user
  router.get('/top/:count', usersController.topHolders); 

  app.use('/users', router);
};
