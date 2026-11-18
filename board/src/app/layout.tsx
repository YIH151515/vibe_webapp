import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import {readOptionalPageSession} from "@/lib/server/auth-page";
import {UserMenu} from "@/components/user-menu";
export const dynamic="force-dynamic";

export const metadata: Metadata = {
  title: "자유 게시판",
  description: "회사 구성원이 이야기를 나누는 자유 게시판",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const session=await readOptionalPageSession();
  return (
    <html lang="ko">
      <body>
        <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
        <header className="site-header">
          <div className="header-inner">
            <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">자</span>자유 게시판</Link>
            <UserMenu session={session}/>
          </div>
        </header>
        <main className="main-container" id="main-content">{children}</main>
        <footer className="site-footer"><span>자유롭게 나누고, 서로를 존중해요.</span></footer>
      </body>
    </html>
  );
}
