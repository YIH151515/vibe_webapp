import Link from "next/link";

export default function NotFound(): React.JSX.Element {
  return <div className="feedback"><p className="eyebrow">404</p><h1>페이지를 찾을 수 없습니다</h1><p>주소가 올바른지 확인해 주세요.</p><Link className="button primary" href="/">목록으로</Link></div>;
}
