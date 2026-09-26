import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paipa — ไปป่ะ?",
  description: "สร้างทริปกับเพื่อน ชวนกันไปเที่ยวให้เป็นเรื่องง่าย",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="th"><body>{children}</body></html>;
}
