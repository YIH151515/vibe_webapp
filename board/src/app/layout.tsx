import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "자유 게시판",
  description: "닉네임으로 편하게 이야기를 나누는 자유 게시판",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
