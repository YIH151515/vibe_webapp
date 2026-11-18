// Password-based release verification has been retired.
export { verifyLiveEntra } from "./verify-live-entra";
import { liveEntraMain } from "./verify-live-entra";
import { resolve } from "node:path";
if(process.argv[1]&&resolve(process.argv[1])===resolve("scripts/verify-live.ts"))void liveEntraMain().catch(()=>{console.error("LIVE_ENTRA_CHECK_FAILED");process.exitCode=1;});
