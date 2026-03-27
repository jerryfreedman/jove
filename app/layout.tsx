import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jove",
  description: "Personal AI sales intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-jove-bg text-jove-cream">
        {children}
      </body>
    </html>
  );
}
