import "./globals.css";
import type { Metadata, Viewport } from "next";

const name = process.env.NEXT_PUBLIC_APP_NAME || "Tsehafi AI";
export const metadata: Metadata = { title: name, description: "AI secretary for your Telegram customer conversations" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fbf8f1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:ital,wght@0,400;0,500;1,500&family=Noto+Sans+Ethiopic:wght@400;600&family=Noto+Serif+Ethiopic:wght@400;600&display=swap" />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
