export const isDevEnv = true // process.env.REACT_APP_ENV==="development"

// Get projectId from https://cloud.reown.com
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || "d12f34d58e09877ad612f47b1f0b8001" // this is a public projectId only to use on localhost

if (!projectId) {
  throw new Error('Project ID is not defined')
}

export const API_ENDPOINT = isDevEnv ? `http://localhost:5000` : `https://api.ethism.fun`
export const FILE_ENDPOINT = `${API_ENDPOINT}/uploads` // `https://files.ethism.fun/`

// export const IPFS_UPLOAD_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS"
//export const IPFS_GATEWAY_URL = "https://coffee-magnetic-rattlesnake-502.mypinata.cloud/ipfs"

export const ETHISM_TELEGRAM_URL = "https://t.me/Ethismdotfun"
export const ETHISM_TWITTER_URL = "https://x.com/ethismfun"
export const ETHISM_WEBSITE_URL = "https://ethism.fun"