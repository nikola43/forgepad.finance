const { S3Client } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');

dotenv.config();

// Create S3 client for Supabase S3-compatible storage
const s3Client = new S3Client({
  region: process.env.SUPABASE_S3_REGION || 'eu-west-1',
  endpoint: process.env.SUPABASE_S3_URL,
  credentials: {
    accessKeyId: process.env.SUPABASE_S3_KEY,
    secretAccessKey: process.env.SUPABASE_S3_SECRET
  },
  forcePathStyle: true // Required for Supabase S3
});

// S3 configuration
const S3_CONFIG = {
  BUCKET_NAME: process.env.SUPABASE_S3_BUCKET || 'forgepad',
  REGION: process.env.SUPABASE_S3_REGION || 'eu-west-1',
  ENDPOINT: process.env.SUPABASE_S3_URL,
  IMAGES_FOLDER: 'token-logos/',
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
};

// Helper function to get Supabase public URL
function getSupabasePublicUrl(key) {
  const projectUrl = process.env.SUPABASE_PROJECT_URL;
  const bucket = S3_CONFIG.BUCKET_NAME;
  return `${projectUrl}/storage/v1/object/public/${bucket}/${key}`;
}

module.exports = {
  s3Client,
  S3_CONFIG,
  getSupabasePublicUrl
};
