import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "БАР — бесплатный анализ релевантности",
  description: "Автоматический поиск конкурентов и семантический анализ: леммы, словоформы, N-граммы, частоты, релевантные документы и рекомендуемый объём текста.",
};

export default function AnalyzerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
