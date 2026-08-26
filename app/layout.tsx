import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

function trustedSiteOrigin(): URL {
  const fallback = new URL("http://localhost:3000");
  const configured = process.env.SITE_URL?.trim();
  if (!configured) return fallback;

  try {
    const url = new URL(configured);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return fallback;
    return new URL(url.origin);
  } catch {
    return fallback;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = trustedSiteOrigin();
  return {
    metadataBase,
    title: "БАР — бесплатный анализ релевантности",
    description: "Бесплатный анализ релевантности страницы в сравнении с поисковыми конкурентами: леммы, N‑граммы, тематический профиль и рекомендации.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "БАР — бесплатный анализ релевантности",
      description: "Сравнение страницы с поисковыми конкурентами",
      type: "website",
      locale: "ru_RU",
      images: [{ url: "/og.png", width: 1731, height: 909, alt: "БАР — бесплатный анализ релевантности страницы" }],
    },
    twitter: { card: "summary_large_image", title: "БАР — бесплатный анализ релевантности", description: "Сравнение страницы с поисковыми конкурентами", images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body className={geistSans.variable + " " + geistMono.variable}>{children}</body></html>;
}
