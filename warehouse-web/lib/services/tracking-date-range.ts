import { ApiError } from "@/lib/api-response";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildTrackingCreatedAtRange(input: { startDate?: string; endDate?: string }) {
  const start = input.startDate ? parseShanghaiDateStart(input.startDate, "开始日期") : undefined;
  const endStart = input.endDate ? parseShanghaiDateStart(input.endDate, "结束日期") : undefined;
  if (start && endStart && start.getTime() > endStart.getTime()) {
    throw new ApiError("开始日期不能晚于结束日期", 400);
  }
  if (!start && !endStart) return undefined;
  return {
    ...(start ? { gte: start } : {}),
    ...(endStart ? { lt: new Date(endStart.getTime() + DAY_MS) } : {})
  };
}

function parseShanghaiDateStart(value: string, label: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ApiError(`${label}格式无效`, 400);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year
    || utcDate.getUTCMonth() !== month - 1
    || utcDate.getUTCDate() !== day
  ) {
    throw new ApiError(`${label}格式无效`, 400);
  }
  return new Date(utcDate.getTime() - SHANGHAI_OFFSET_MS);
}
