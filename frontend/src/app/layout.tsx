import type { Metadata, Viewport } from "next";

import ContextProvider from '@/context'
import MainLayout from "@/components/layout"
import '@/assets/globals.css'

const SITE_URL = "https://arrowpad.io";
const DESCRIPTION =
  "ArrowPad is the token launchpad built for Robinhood Chain. Launch a coin in seconds on a fair bonding curve, trade instantly with 1% fees, and auto-graduate to Uniswap. The pump.fun of Robinhood Chain.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "ArrowPad — Launch & Trade Tokens on Robinhood Chain",
    template: "%s | ArrowPad",
  },
  description: DESCRIPTION,
  applicationName: "ArrowPad",
  keywords: [
    "ArrowPad",
    "Robinhood Chain",
    "Robinhood Chain launchpad",
    "Robinhood Chain pump fun",
    "Robinhood Chain memecoin",
    "launch token on Robinhood Chain",
    "Robinhood Chain token launch",
    "Robinhood Chain DEX",
    "create memecoin",
    "bonding curve launchpad",
    "Uniswap graduation",
    "pump fun clone",
  ],
  authors: [{ name: "ArrowPad" }],
  creator: "ArrowPad",
  publisher: "ArrowPad",
  alternates: { canonical: "/" },
  icons: ['/favicon.png'],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "ArrowPad",
    title: "ArrowPad — Launch & Trade Tokens on Robinhood Chain",
    description: DESCRIPTION,
    images: [
      { url: "/images/logo.png", width: 1024, height: 1024, alt: "ArrowPad" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@arrowpad",
    creator: "@arrowpad",
    title: "ArrowPad — Launch & Trade Tokens on Robinhood Chain",
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
  themeColor: "#D3FF24",
  colorScheme: "dark",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "ArrowPad",
      url: SITE_URL,
      logo: `${SITE_URL}/images/logo.png`,
      description: DESCRIPTION,
      sameAs: ["https://t.me/arrowpad", "https://x.com/arrowpad"],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "ArrowPad",
      description: DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "WebApplication",
      name: "ArrowPad",
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
