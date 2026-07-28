import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fyuz — Two Icons Enter. One Market Leaves.",
    short_name: "Fyuz",
    description:
      "The cultural launchpad where the internet fuses personalities, narratives and communities into live meme markets.",
    start_url: "/",
    display: "standalone",
    // The chamber (§08 moss black). The app icon is the wordmark avatar — the same
    // mark used as the @fyuzfun profile image, so install prompts and social cards
    // match the account people arrive from.
    background_color: "#131208",
    theme_color: "#131208",
    icons: [
      { src: "/favicon.png", sizes: "128x128", type: "image/png" },
      { src: "/images/logo.png", sizes: "1024x1024", type: "image/png" },
    ],
  };
}
