// const verifyToken = require("../middleware/index.js");
const multer = require('multer');
const multerS3 = require('multer-s3');
const { s3Client, S3_CONFIG } = require('../config/s3.config');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Use multer-s3 for direct S3 uploads
const storage = multerS3({
  s3: s3Client,
  bucket: S3_CONFIG.BUCKET_NAME,
  key: (req, file, cb) => {
    const uniqueSuffix = uuidv4();
    const extension = path.extname(file.originalname);
    const filename = `${uniqueSuffix}${extension}`;
    const key = `${S3_CONFIG.IMAGES_FOLDER}${filename}`;

    console.log(`Uploading to S3: bucket=${S3_CONFIG.BUCKET_NAME}, key=${key}`);
    cb(null, key);
  },
  metadata: (req, file, cb) => {
    cb(null, {
      fieldName: file.fieldname,
      originalName: file.originalname,
      uploadedAt: new Date().toISOString()
    });
  },
  contentType: multerS3.AUTO_CONTENT_TYPE
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: S3_CONFIG.MAX_FILE_SIZE
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (S3_CONFIG.ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
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
