import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Jove",
  description: "Personal AI sales intelligence",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "mobile-web-app-capable": "yes",
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
        <meta name="theme-color" content="#020408" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <script dangerouslySetInnerHTML={{ __html: `
(function() {
  try {
    var h = new Date().getHours();
    var c = h >= 22 || h < 5  ? '#020408'
          : h < 6             ? '#04060c'
          : h < 8             ? '#6888a8'
          : h < 11            ? '#3a88cc'
          : h < 16            ? '#2070b8'
          : h < 19            ? '#0f0618'
          : '#08040e';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', c);
  } catch(e) {}
})();
        ` }} />
      </head>
      <body className="font-sans antialiased bg-jove-bg text-jove-cream">
        {children}
      </body>
    </html>
  );
}
