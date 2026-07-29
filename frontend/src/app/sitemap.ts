import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const SITE_URL = "https://fyuz.fun";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/create`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/leaderboard`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/fees`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
  ];
}
