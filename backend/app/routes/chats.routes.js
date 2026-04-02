module.exports = app => {
  const chatsController = require("../controllers/chats.controller.js");

  var router = require("express").Router();
  
  router.post('/', chatsController.getChatsByTokenAddress); // get all chats with this token
  router.post('/reply', chatsController.replyByTokenAddress); // reply a msg on this token

  app.use('/chats', router);
};
