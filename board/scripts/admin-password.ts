import { hashPassword } from "../src/lib/server/password";
async function main(){
 if(process.argv.length>2||process.stdin.isTTY)throw new Error("비밀번호는 명령 인수 대신 비공개 stdin으로 전달해 주세요.");
 let value="";for await(const chunk of process.stdin){value+=chunk.toString();if(Buffer.byteLength(value)>1024)throw new Error("입력이 너무 깁니다.");}
 value=value.replace(/\r?\n$/,"");
 if(value.length<8||value.length>128||!value.trim())throw new Error("비밀번호는 8~128자여야 합니다.");
 process.stdout.write(await hashPassword(value)+"\n");
}
void main().catch(()=>{console.error("관리자 비밀번호 입력을 확인해 주세요. stdin만 허용합니다.");process.exitCode=1;});
