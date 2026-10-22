import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { LiveRegionsProvider } from "../components/LiveRegions";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KarenPay — Voice Payment Consent",
  description:
    "Send money with your voice. Nothing moves until you have heard the exact action and approved it with your fingerprint or face.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-bg font-sans text-base text-text antialiased">
        <LiveRegionsProvider>{children}</LiveRegionsProvider>
      </body>
    </html>
  );
}
