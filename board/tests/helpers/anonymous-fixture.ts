import { test as base } from "@playwright/test";
import { newClientIp } from "./client-fixture";
export { expect } from "@playwright/test";
export const test = base.extend({
 context: async ({context},provide)=>{await context.setExtraHTTPHeaders({"client-ip":newClientIp()});await provide(context);},
 request: async ({playwright,baseURL},provide)=>{
  const context=await playwright.request.newContext({baseURL,storageState:{cookies:[],origins:[]},extraHTTPHeaders:{"client-ip":newClientIp()}});
  try{await provide(context);}finally{await context.dispose();}
 }
});
