import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { GuildShell } from "@/components/guild/GuildShell";
import { getAppearanceInitializerScript } from "@/lib/appearance";
import "./globals.css";

const firaCode = localFont({
  src: [
    { path: "../public/fonts/FiraCodeNerdFont-Regular.ttf", weight: "400", style: "normal" },
    { path: "../public/fonts/FiraCodeNerdFont-Medium.ttf", weight: "500", style: "normal" },
    { path: "../public/fonts/FiraCodeNerdFont-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../public/fonts/FiraCodeNerdFont-Bold.ttf", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-ui-loaded",
});

const firaCodeMono = localFont({
  src: [
    { path: "../public/fonts/FiraCodeNerdFontMono-Regular.ttf", weight: "400", style: "normal" },
    { path: "../public/fonts/FiraCodeNerdFontMono-SemiBold.ttf", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-runtime-loaded",
});

export const metadata: Metadata = {
  title: {
    default: "Lanternwatch · Agent Runtime",
    template: "%s · Lanternwatch",
  },
  description: "Watch an AI project team collaborate through a clear live text workflow.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#18130e",
};

const themeInitializer = getAppearanceInitializerScript();

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${firaCode.variable} ${firaCodeMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <GuildShell>{children}</GuildShell>
        <Script id="lanternwatch-theme" strategy="beforeInteractive">
          {themeInitializer}
        </Script>
      </body>
    </html>
  );
}
