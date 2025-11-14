# Supabase Storage Setup Guide

This guide will help you configure Supabase Storage for token logo uploads.

## Prerequisites

1. Active Supabase project at https://supabase.com
2. Project ID: `vfffrmlgpqyryhjudhqy`

## Setup Steps

### 1. Get Your Supabase Service Key

1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/vfffrmlgpqyryhjudhqy
2. Navigate to **Project Settings** (gear icon in sidebar)
3. Click on **API** section
4. Copy the `service_role` key (NOT the `anon` key)
5. Update `.env` file with this key:
   ```
   SUPABASE_SERVICE_KEY="your_service_role_key_here"
   ```

### 2. Create Storage Bucket

1. In your Supabase Dashboard, go to **Storage** (in the sidebar)
2. Click **Create a new bucket**
3. Bucket details:
   - **Name**: `token-logos`
   - **Public bucket**: ✓ Checked (so logos are publicly accessible)
4. Click **Create bucket**

### 3. Configure Bucket Policies (Important!)

After creating the bucket, you need to set up access policies:

1. Click on the `token-logos` bucket
2. Go to **Policies** tab
3. Click **New Policy** and create the following policies:

#### Policy 1: Public Read Access
- **Policy Name**: `Public read access`
- **Policy Definition**: Select "Get objects" template
- **Target roles**: `public`
- **Policy definition**:
  ```sql
  CREATE POLICY "Public read access"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'token-logos');
  ```

#### Policy 2: Service Role Upload Access
- **Policy Name**: `Service role can upload`
- **Policy Definition**: Select "Insert objects" template
- **Target roles**: `service_role`
- **Policy definition**:
  ```sql
  CREATE POLICY "Service role can upload"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'token-logos');
  ```

#### Policy 3: Service Role Delete Access
- **Policy Name**: `Service role can delete`
- **Policy Definition**: Select "Delete objects" template
- **Target roles**: `service_role`
- **Policy definition**:
  ```sql
  CREATE POLICY "Service role can delete"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'token-logos');
  ```

### 4. Test the Upload

Once configured, you can test the upload with:

```bash
curl -X POST http://localhost:5001/tokens/upload \
  -H "api-key: hola" \
  -F "image=@/path/to/test-image.png"
```

Expected response:
```json
{
  "success": true,
  "message": "File uploaded successfully to Supabase Storage.",
  "url": "https://vfffrmlgpqyryhjudhqy.supabase.co/storage/v1/object/public/token-logos/1234567890-image.png",
  "path": "1234567890-image.png",
  "file": {
    "originalname": "test-image.png",
    "mimetype": "image/png",
    "size": 12345
  }
}
```

## File Upload Configuration

- **Max file size**: 5MB
- **Allowed file types**: Images only (image/*)
- **Naming convention**: `{timestamp}-{sanitized_filename}`
- **Cache control**: 3600 seconds (1 hour)

## API Endpoint

**POST** `/tokens/upload`

**Headers**:
- `api-key`: Your API key (configured in `.env`)

**Body** (multipart/form-data):
- `image`: Image file to upload

**Response**:
```json
{
  "success": true,
  "message": "File uploaded successfully to Supabase Storage.",
  "url": "https://...",
  "path": "...",
  "file": {
    "originalname": "...",
    "mimetype": "...",
    "size": 123
  }
}
```

## Troubleshooting

### Error: "Missing Supabase configuration"
- Make sure `SUPABASE_PROJECT_URL` and `SUPABASE_SERVICE_KEY` are set in `.env`

### Error: "new row violates row-level security policy"
- Check that you've created the storage bucket policies correctly
- Verify the service role key is correct

### Error: "Bucket not found"
- Make sure the bucket `token-logos` is created
- Check the bucket name matches exactly (case-sensitive)

### Files upload but return 404 when accessed
- Ensure the bucket is set to **Public**
- Check that the public read policy is enabled

## Migration from Local Storage

The previous implementation saved files to `/srv/public-files/`. Files uploaded to Supabase will now be stored in the cloud and accessible via the returned URL. You may want to migrate existing logos to Supabase if needed.

## Configuration Files

- **Storage config**: `app/config/storage.config.js`
- **Upload routes**: `app/routes/tokens.routes.js`
- **Upload controller**: `app/controllers/tokens.controller.js` (uploadLogo function)
