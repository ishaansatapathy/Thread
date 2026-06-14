import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { caveat, threadHero } from "~/lib/fonts";
import { GlobalProviders } from "~/providers/global";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Thread — Work at the speed of thought",
  description:
    "The professional inbox for email and calendar. Rank urgency, draft replies, and schedule invites — one workspace, your rules.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

import type { ReactNode } from "react";

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: "html,body{background:#020202!important;color:#fff}",
          }}
        />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} ${threadHero.variable} bg-(--landing-bg) text-white antialiased`}
      >
        <GlobalProviders>{children}</GlobalProviders>
      </body>
    </html>
  );
}
