import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#2070b8",
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
            var c = h >= 22 || h < 5 ? '#020408'
                  : h < 6  ? '#04060c'
                  : h < 8  ? '#6888a8'
                  : h < 11 ? '#3a88cc'
                  : h < 16 ? '#2070b8'
                  : h < 19 ? '#0f0618'
                  : '#08040e';
            var meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', c);
          })();
        ` }} />
      </head>
      <body className="font-sans antialiased bg-jove-bg text-jove-cream">
        {children}
      </body>
    </html>
  );
}
