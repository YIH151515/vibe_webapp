import type { Metadata } from "next";
import Link from "next/link";
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
      <body>
        <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
        <header className="site-header">
          <div className="header-inner">
            <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">자</span>자유 게시판</Link>
            <span className="header-note"><span className="status-dot" />누구에게나 열린 공간</span>
          </div>
        </header>
        <main className="main-container" id="main-content">{children}</main>
        <footer className="site-footer"><span>자유롭게 나누고, 서로를 존중해요.</span><Link href="/admin">관리자</Link></footer>
      </body>
    </html>
  );
}
