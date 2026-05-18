const UNIT_FACTORS: Record<string, number> = {
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
};

export function parseHumanSize(value: string): number {
  if (!value || value === "N/A") return 0;
  const match = /^(\d+(?:\.\d+)?)\s*([KMGT])?(?:iB?)?$/i.exec(value.trim());
  if (!match) return 0;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return 0;
  const unit = (match[2] || "").toUpperCase();
  return unit ? num * UNIT_FACTORS[unit] : num;
}

export function parsePercent(value: string): number {
  if (!value || value === "N/A") return 0;
  const num = Number(value.replace("%", "").trim());
  return Number.isFinite(num) ? num : 0;
}

export interface FlatMetrics {
  cpu: string;
  ramUsed: string;
  ramTotal: string;
  diskUsed: string;
  diskTotal: string;
  diskPercent: string;
}

export interface StructuredMetrics {
  cpu: { percent: number };
  mem: { percent: number; total: number; used: number };
  disk: { percent: number; total: number; used: number };
}

export function buildMetrics(flat: FlatMetrics): StructuredMetrics {
  const memTotal = parseHumanSize(flat.ramTotal);
  const memUsed  = parseHumanSize(flat.ramUsed);
  const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
  return {
    cpu:  { percent: parsePercent(flat.cpu) },
    mem:  { percent: memPercent, total: memTotal, used: memUsed },
    disk: { percent: parsePercent(flat.diskPercent), total: parseHumanSize(flat.diskTotal), used: parseHumanSize(flat.diskUsed) },
  };
}
