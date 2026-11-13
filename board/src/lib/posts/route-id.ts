import { notFound } from "next/navigation";

export function routePostId(raw: string): number {
  if (raw !== raw.trim() || !/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) notFound();
  return Number(raw);
}
