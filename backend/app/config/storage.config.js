const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase configuration. Please set SUPABASE_PROJECT_URL and SUPABASE_SERVICE_KEY in .env file');
}

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Storage bucket name
const BUCKET_NAME = 'token-logos';

/**
 * Upload file to Supabase Storage
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - File name
 * @param {string} contentType - File content type
 * @returns {Promise<{url: string, path: string}>}
 */
async function uploadFile(fileBuffer, fileName, contentType) {
  try {
    // Generate unique file name
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${timestamp}-${sanitizedFileName}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, fileBuffer, {
        contentType,
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw error;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    return {
      url: urlData.publicUrl,
      path: filePath
    };
  } catch (error) {
    console.error('Error uploading file to Supabase:', error);
    throw error;
  }
}

/**
 * Delete file from Supabase Storage
 * @param {string} filePath - File path in storage
 * @returns {Promise<void>}
 */
async function deleteFile(filePath) {
  try {
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Error deleting file from Supabase:', error);
    throw error;
  }
}

module.exports = {
  supabase,
  BUCKET_NAME,
  uploadFile,
  deleteFile
};
