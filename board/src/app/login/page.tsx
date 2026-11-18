import { readAuthConfig } from "@/lib/server/auth-config";
import { safeReturnTo } from "@/lib/server/auth-flow";
export const dynamic="force-dynamic";
export default async function LoginPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams;let enabled=false;
 try{enabled=readAuthConfig().mode==="entra";}catch{}
 const error=typeof params.error==="string"?({cancelled:"로그인을 취소했습니다. 다시 시도할 수 있습니다.",denied:"이 게시판은 회사 구성원만 이용할 수 있습니다.",failed:"로그인을 완료하지 못했습니다. 다시 시도해 주세요."} as Record<string,string>)[params.error]:undefined;
 return <section className="panel editor login-panel"><p className="eyebrow">우리 회사의 이야기 공간</p><h1>회사 계정으로 시작하세요</h1><p>회사 구성원만 게시판을 읽고 이야기를 나눌 수 있습니다.</p>{error&&<p role="alert" className="error-message">{error}</p>}
 {enabled?<form method="post" action="/api/auth/login"><input type="hidden" name="returnTo" value={safeReturnTo(params.returnTo)}/><button type="submit" className="button primary">회사 계정으로 로그인</button></form>:<><p role="status">로그인 기능을 준비하고 있습니다. 잠시 후 다시 접속해 주세요.</p><button className="button primary" disabled>회사 계정으로 로그인</button></>}
 </section>;
}
