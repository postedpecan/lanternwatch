import type { Metadata, Viewport } from "next";
import { Caveat } from "next/font/google";
import Script from "next/script";
import { GuildShell } from "@/components/guild/GuildShell";
import "./globals.css";

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-caveat",
});

export const metadata: Metadata = {
  title: "Lanternwatch — Agent Runtime",
  description: "Watch AI agents collaborate through a clear live text workflow.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4ead8",
};

const themeInitializer = `
  (function () {
    var theme = "light";
    try {
      theme = localStorage.getItem("lanternwatch-theme") === "dark" ? "dark" : "light";
    } catch (_) {}
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#171513" : "#f4ead8");
  })();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={caveat.variable} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <GuildShell>{children}</GuildShell>
        <Script id="lanternwatch-theme" strategy="beforeInteractive">
          {themeInitializer}
        </Script>
      </body>
    </html>
  );
}
