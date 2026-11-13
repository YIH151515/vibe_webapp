import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { assertTestDatabase } from "./database";
import { BoardError } from "./errors";

function unavailable(): never {
  throw new BoardError("SERVICE_UNAVAILABLE", 503, "요청 보안 설정을 확인해 주세요.");
}

export function readAppOrigin(env: NodeJS.ProcessEnv = process.env): URL {
  try {
    const value = env.APP_ORIGIN;
    if (!value) unavailable();
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) unavailable();
    return url;
  } catch { unavailable(); }
}

export function normalizeClientIp(value: string): string {
  if (!value || value !== value.trim() || /[,\s%]/.test(value)) unavailable();
  let address = value;
  let port: string | undefined;
  if (value.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::([0-9]+))?$/.exec(value);
    if (!match || isIP(match[1]) !== 6) unavailable();
    address = match[1]; port = match[2];
  } else if (!isIP(value)) {
    const match = /^([^:]+):([0-9]+)$/.exec(value);
    if (!match || isIP(match[1]) !== 4) unavailable();
    address = match[1]; port = match[2];
  }
  if (port !== undefined && (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)) unavailable();
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) unavailable();
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return canonical;
}

export function readRequestConfig(env: NodeJS.ProcessEnv = process.env): {
  origin: URL; mode: "local" | "app-service" | "test"; secret: Buffer; localIp?: string;
} {
  const origin = readAppOrigin(env);
  const mode = env.REQUEST_IP_MODE;
  const secret = env.RATE_LIMIT_KEY_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret) || secret.length !== 64) unavailable();
  if (mode === "app-service") {
    if (!env.WEBSITE_INSTANCE_ID || origin.protocol !== "https:" || env.APP_TEST_MODE === "1") unavailable();
  } else if (mode === "test") {
    try { assertTestDatabase(env); } catch { unavailable(); }
  } else if (mode !== "local") unavailable();
  return {
    origin, mode, secret: Buffer.from(secret, "hex"),
    localIp: mode === "local" ? normalizeClientIp(env.LOCAL_CLIENT_IP ?? "") : undefined,
  };
}

export function getClientKey(request: Request): string {
  const config = readRequestConfig();
  const ip = config.mode === "local"
    ? config.localIp!
    : normalizeClientIp(request.headers.get("client-ip") ?? "");
  return createHmac("sha256", config.secret).update(ip).digest("hex");
}
