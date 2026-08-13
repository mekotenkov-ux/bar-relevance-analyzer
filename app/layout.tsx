import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost:3001";
  const protocol = host.includes("localhost") ? "http" : "https";
  const imageUrl = protocol + "://" + host + "/og.png";
  return {
    title: "Copykiller Semantic — отчёт релевантности",
    description: "Семантический анализ страницы в сравнении с конкурентами: леммы, N‑граммы, тематический профиль и рекомендации.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Copykiller Semantic",
      description: "Отчёт по релевантности страницы",
      type: "website",
      locale: "ru_RU",
      images: [{ url: imageUrl, width: 1748, height: 915, alt: "Copykiller Semantic — отчёт по релевантности страницы" }],
    },
    twitter: { card: "summary_large_image", title: "Copykiller Semantic", description: "Отчёт по релевантности страницы", images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body className={geistSans.variable + " " + geistMono.variable}>{children}</body></html>;
}
