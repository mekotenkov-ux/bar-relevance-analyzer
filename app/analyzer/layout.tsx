import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Copykiller Semantic — онлайн-анализатор страниц",
  description: "Добавьте URL или тексты своей страницы и конкурентов. Сервис рассчитает леммы, TF‑IDF, N‑граммы, релевантность и рекомендуемый объём текста.",
};

export default function AnalyzerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
