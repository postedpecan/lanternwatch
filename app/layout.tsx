import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { GuildShell } from "@/components/guild/GuildShell";
import { getAppearanceInitializerScript } from "@/lib/appearance";
import "./globals.css";

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
  themeColor: "#f6f8fa",
};

const themeInitializer = getAppearanceInitializerScript();

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <GuildShell>{children}</GuildShell>
        <Script id="lanternwatch-theme" strategy="beforeInteractive">
          {themeInitializer}
        </Script>
      </body>
    </html>
  );
}
