import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import PageShell from "@/components/PageShell";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Parkinson AI",
  description: "AI-powered Parkinson's disease monitoring and assistance",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <PageShell>{children}</PageShell>
        </AuthProvider>
      </body>
    </html>
  );
}
