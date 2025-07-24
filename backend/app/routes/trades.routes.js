// const verifyToken = require("../middleware/index.js");

module.exports = app => {
  const tradesController = require("../controllers/trades.controller.js");

  var router = require("express").Router();

  router.post('/', tradesController.getAllTradesByToken); // all trades on token address
  router.get('/getChartData', tradesController.getChartData); // all trades on token address
  router.get('/recent', tradesController.getLatestTrades);

  app.use('/trades', router);
};
