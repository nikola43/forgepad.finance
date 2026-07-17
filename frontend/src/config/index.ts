export const isDevEnv = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_LOCAL_MODE === "true"

// Get projectId from https://cloud.reown.com
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || "d12f34d58e09877ad612f47b1f0b8001"

if (!projectId) {
  throw new Error('Project ID is not defined')
}

export const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL || `http://localhost:5001`
export const FILE_ENDPOINT = process.env.NEXT_PUBLIC_FILE_URL || `${API_ENDPOINT}/uploads`

export const FYUZ_TWITTER_URL = "https://x.com/fyuzfun"
export const FYUZ_WEBSITE_URL = "https://fyuz.fun"

// Curated fusion universes/styles — mirrors backend-rs image_gen::STYLES labels.
// Used by the create form (chips) and the home style filter.
export const STYLE_PRESETS = [
  "Dragon Ball Z / anime action",
  "Cyberpunk neon",
  "Medieval fantasy",
  "Studio Ghibli-style",
  "Pixel art / 8-bit",
  "Film noir comic",
  "Classic superhero comic",
  "Renaissance oil painting",
  "Claymation / stop-motion",
  "Retro 80s synthwave",
  "Steampunk",
  "Wild West",
  "Ancient mythology (Greek/Norse)",
  "Space opera / sci-fi epic",
  "Watercolor illustration",
  "Graffiti / street art",
  "Samurai / feudal Japan",
  "Post-apocalyptic wasteland",
  "Pop art (Warhol-style)",
  "Gothic horror",
  "Egyptian mythology",
  "Cartoon Network style",
  "Vaporwave",
  "Baroque royal portrait",
  "Manga black-and-white",
]

