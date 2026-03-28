import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#060a12",
};

export const metadata: Metadata = {
  title: "Jove",
  description: "Personal AI sales intelligence",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var h = new Date().getHours();
            var isDark = h >= 19 || h < 8;
            var meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', isDark ? '#060a12' : '#F7F3EC');
          })();
        ` }} />
      </head>
      <body className="font-sans antialiased bg-jove-bg text-jove-cream">
        {children}
      </body>
    </html>
  );
}
