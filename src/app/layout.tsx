import type { Metadata } from "next";
import { Fredoka, Prompt } from "next/font/google";
import "./globals.css";

const prompt = Prompt({ subsets: ["latin", "thai"], weight: ["300", "400", "500", "600", "700", "800"], variable: "--font-prompt", display: "swap" });
const fredoka = Fredoka({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-fredoka", display: "swap" });

export const metadata: Metadata = {
  title: "Paipa — ไปป่ะ?",
  description: "สร้างทริปกับเพื่อน ชวนกันไปเที่ยวให้เป็นเรื่องง่าย",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${prompt.variable} ${fredoka.variable}`}>
      <body>{children}</body>
    </html>
  );
}
