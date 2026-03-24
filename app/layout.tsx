import "./globals.css";
import "katex/dist/katex.min.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Personal Paper Research Assistant",
  description: "Advanced research tool for scholars.",
};

export default function ResearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="min-h-screen bg-[#f8f9fa] selection:bg-teal-100 selection:text-teal-900">
          {children}
        </div>
      </body>
    </html>
  );
}
