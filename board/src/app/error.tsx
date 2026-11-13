"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }): React.JSX.Element {
  return <div className="feedback" role="alert"><h1>화면을 불러오지 못했습니다</h1><p>잠시 후 다시 시도해 주세요.</p><div className="actions"><button type="button" className="button primary" onClick={reset}>다시 시도</button><Link className="button secondary" href="/">목록으로</Link></div></div>;
}
