import type { Metadata } from "next";

import ContextProvider from '@/context'
import MainLayout from "@/components/layout"
import '@/assets/globals.css'

export const metadata: Metadata = {
  title: "ForgePad",
  description: "Forge Pad Finance",
  icons: ['/favicon.ico']
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // const headersData = await headers();
  // const cookies = headersData.get('cookie');

  return (
    <html lang="en">
      <body>
        <ContextProvider>
          <MainLayout>{children}</MainLayout>
        </ContextProvider>
      </body>
    </html>
  );
}
