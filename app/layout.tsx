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
  description: "A system that keeps track of what's going on and tells you what matters next.",
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
    document.documentElement.style.backgroundColor = c;
    if (document.body) {
      document.body.style.backgroundColor = c;
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        document.body.style.backgroundColor = c;
      });
    }
  } catch(e) {}
})();
` }} />
        <meta name="theme-color" content="#060a12" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />
        <link rel="shortcut icon" href="/favicon.ico" />
      </head>
      <body className="font-sans antialiased text-jove-cream">
        {children}
      </body>
    </html>
  );
}
