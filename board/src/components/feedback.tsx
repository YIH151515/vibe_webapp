import Link from "next/link";
import { ApiError } from "@/lib/client/api";

export function Loading(): React.JSX.Element {
  return <div className="feedback" role="status" aria-busy="true"><span className="loading-dot" />이야기를 불러오고 있어요.</div>;
}

export function Failure({ error, retry }: { error: unknown; retry?: () => void }): React.JSX.Element {
  const unauthenticated = error instanceof ApiError && error.status === 401;
  const denied = error instanceof ApiError && error.status === 403;
  const missing = error instanceof ApiError && error.status === 404;
  return (
    <div className="feedback" role="alert">
      <h1>{unauthenticated ? "다시 로그인해 주세요" : denied ? "접근 권한이 없습니다" : missing ? "글을 찾을 수 없습니다" : "불러오지 못했습니다"}</h1>
      <p>{error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요."}</p>
      <div className="actions">
        {unauthenticated && <Link className="button primary" href="/login">회사 계정으로 로그인</Link>}
        {retry && !missing && !unauthenticated && !denied && <button type="button" className="button secondary" onClick={retry}>다시 시도</button>}
        <Link className="button secondary" href="/">목록으로</Link>
      </div>
    </div>
  );
}
