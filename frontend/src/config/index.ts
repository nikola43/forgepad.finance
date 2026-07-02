export const isDevEnv = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_LOCAL_MODE === "true"

// Get projectId from https://cloud.reown.com
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || "d12f34d58e09877ad612f47b1f0b8001"

if (!projectId) {
  throw new Error('Project ID is not defined')
}

export const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL || `http://localhost:5001`
export const FILE_ENDPOINT = process.env.NEXT_PUBLIC_FILE_URL || `${API_ENDPOINT}/uploads`

export const FORGE_TWITTER_URL = "https://x.com/RobinArrowPad"
export const FORGE_WEBSITE_URL = "https://arrowpad.io"

