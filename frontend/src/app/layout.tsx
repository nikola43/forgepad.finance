import type { Metadata, Viewport } from "next";

import ContextProvider from '@/context'
import MainLayout from "@/components/layout"
import { FYUZ_TWITTER_URL } from "@/config"
import '@/assets/globals.css'

const SITE_URL = "https://fyuz.fun";
const DESCRIPTION =
  "Fyuz is the cultural launchpad where the internet fuses personalities, narratives and communities into live meme markets. Pick two icons, fuse them into a character, launch a token on BNB Smart Chain. A bonding curve sets the price; graduated tokens migrate to PancakeSwap.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Fyuz — Two Icons Enter. One Market Leaves.",
    template: "%s | Fyuz",
  },
  description: DESCRIPTION,
  applicationName: "Fyuz",
  keywords: [
    "Fyuz",
    "BNB Smart Chain",
    "BNB Chain launchpad",
    "BNB Chain memecoin",
    "launch token on BNB Chain",
    "BNB Chain token launch",
    "memecoin launchpad",
    "fusion memecoin",
    "create memecoin",
    "bonding curve launchpad",
    "PancakeSwap graduation",
    "cultural launchpad",
  ],
  authors: [{ name: "Fyuz" }],
  creator: "Fyuz",
  publisher: "Fyuz",
  alternates: { canonical: "/" },
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/images/logo.png',
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Fyuz",
    title: "Fyuz — Two Icons Enter. One Market Leaves.",
    description: DESCRIPTION,
    images: [
      { url: "/images/logo.png", width: 1024, height: 1024, alt: "Fyuz" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@fyuzfun",
    creator: "@fyuzfun",
    title: "Fyuz — Two Icons Enter. One Market Leaves.",
    description: DESCRIPTION,
    images: ["/images/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "finance",
};

export const viewport: Viewport = {
  themeColor: "#131208",
  colorScheme: "dark",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Fyuz",
      url: SITE_URL,
      logo: `${SITE_URL}/images/logo.png`,
      description: DESCRIPTION,
      sameAs: [FYUZ_TWITTER_URL],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Fyuz",
      description: DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "WebApplication",
      name: "Fyuz",
      url: SITE_URL,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: DESCRIPTION,
    },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <ContextProvider>
          <MainLayout>{children}</MainLayout>
        </ContextProvider>
      </body>
    </html>
  );
}
