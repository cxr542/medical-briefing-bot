import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "의료 브리핑",
  appleWebApp: { capable: true, title: "의료 브리핑", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  title: "병원·보건의료 종합 모닝 브리핑",
  description:
    "병원·보건의료 정책, 공지, 의료전문지 뉴스를 매일 아침 정리하는 브리핑 대시보드",
};

export const viewport: Viewport = { themeColor: "#F8F9FA" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {process.env.NODE_ENV === "production" && (
          <Script src="/pwa-register.js" strategy="afterInteractive" />
        )}
      </body>
    </html>
  );
}
