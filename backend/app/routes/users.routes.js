const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const useLocalStorage = process.env.USE_LOCAL_STORAGE === 'true';
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB for avatars

let avatarStorage;
if (useLocalStorage) {
  const AVATAR_UPLOAD_DIR = path.join(__dirname, '../../uploads');
  avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_UPLOAD_DIR),
    filename: (req, file, cb) => {
      const filename = `avatar-${uuidv4()}${path.extname(file.originalname)}`;
      cb(null, filename);
    }
  });
} else {
  const multerS3 = require('multer-s3');
  const { s3Client, S3_CONFIG } = require('../config/s3.config');
  avatarStorage = multerS3({
    s3: s3Client,
    bucket: S3_CONFIG.BUCKET_NAME,
    key: (req, file, cb) => {
      const filename = `avatar-${uuidv4()}${path.extname(file.originalname)}`;
      cb(null, `${S3_CONFIG.IMAGES_FOLDER}${filename}`);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE
  });
}

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  }
});

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
  router.post('/avatar', avatarUpload.single('avatar'), usersController.uploadAvatar);
  router.get('/top/:count', usersController.topHolders);

  app.use('/users', router);
};
