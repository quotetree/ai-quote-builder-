import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import RememberSignedInAccount from "@/components/RememberSignedInAccount";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "QuoteTree.ai - AI-Powered Quote Builder",
  description: "Generate professional quotes with AI assistance",
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <RememberSignedInAccount />
        {children}
      </body>
    </html>
  );
}

