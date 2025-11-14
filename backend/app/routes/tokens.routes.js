// const verifyToken = require("../middleware/index.js");
const multer = require('multer');

// Use memory storage instead of disk storage for Supabase upload
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

const API_KEY = process.env.API_KEY;

const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers['api-key'];
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(403).send({ message: 'Forbidden: Invalid API Key' });
  }
  next();
};

module.exports = app => {
  const tokensController = require("../controllers/tokens.controller.js");

  const router = require("express").Router();

  router.get('/', tokensController.getAllTokens); // All tokens for dashboard
  router.post('/', tokensController.createToken);
  router.post('/move/:tokenAddress', tokensController.moveToken);
  // router.post('/myPage', tokensController.myTokens); // one user's All Tokens for my page
  router.get('/:network/:tokenAddress', tokensController.getTokenDetails); //get one token details for the token content page
  router.post('/upload', apiKeyMiddleware, upload.single('image'), tokensController.uploadLogo)

  app.use('/tokens', router);
};
