module.exports = app => {
  const usersController = require("../controllers/users.controller.js");
  const router = require("express").Router();

  router.get('/', usersController.getUserInfo);
  router.get('/ranking', usersController.getRanking);
  router.get('/followings/:address', usersController.getFollowings);
  router.get('/profile/:address', usersController.getUserProfile);
  router.get('/balance/:id', usersController.getBalance);
  router.post('/', usersController.createUser);
  router.post('/follow/:address', usersController.followUser);
  router.post('/unfollow/:address', usersController.unfollowUser);
  router.post('/update', usersController.updateUsername);
  router.get('/top/:count', usersController.topHolders);

  app.use('/users', router);
};
