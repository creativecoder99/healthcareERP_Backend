import { prisma } from "../../config/prisma";
import { redis } from "../../shared/services/redis";

const CACHE_TTL = 600; // 10 minutes

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch { /* redis miss is fine */ }
  const result = await fn();
  try {
    await redis.setex(key, CACHE_TTL, JSON.stringify(result));
  } catch { /* cache write failure is non-fatal */ }
  return result;
}

export async function getTrends(
  patientId: string,
  parameterKey?: string,
  from?: string,
  to?: string
) {
  const cacheKey = `analytics:trends:${patientId}:${parameterKey ?? "all"}:${from ?? ""}:${to ?? ""}`;
  return cached(cacheKey, async () => {
    const where: any = { record: { patientId } };
    if (parameterKey) where.parameterKey = parameterKey.toUpperCase();
    if (from || to) {
      where.recordDate = {};
      if (from) where.recordDate.gte = new Date(from);
      if (to) where.recordDate.lte = new Date(to);
    }

    const rows = await prisma.recordExtractedValue.findMany({
      where,
      orderBy: { recordDate: "asc" },
      select: {
        parameterKey: true,
        parameterLabel: true,
        value: true,
        unit: true,
        referenceMin: true,
        referenceMax: true,
        isAbnormal: true,
        severity: true,
        recordDate: true,
        recordId: true,
      },
    });

    const grouped: Record<string, any> = {};
    for (const row of rows) {
      if (!grouped[row.parameterKey]) {
        grouped[row.parameterKey] = {
          parameterKey: row.parameterKey,
          parameterLabel: row.parameterLabel,
          unit: row.unit,
          referenceMin: row.referenceMin,
          referenceMax: row.referenceMax,
          data: [],
        };
      }
      grouped[row.parameterKey].data.push({
        date: row.recordDate.toISOString().split("T")[0],
        value: row.value,
        isAbnormal: row.isAbnormal,
        severity: row.severity,
        recordId: row.recordId,
      });
    }

    return Object.values(grouped);
  });
}

export async function getHealthScore(patientId: string) {
  const cacheKey = `analytics:health-score:${patientId}`;
  return cached(cacheKey, async () => {
    const now = new Date();
    const ninety = new Date(now);
    ninety.setDate(ninety.getDate() - 90);
    const thirty = new Date(now);
    thirty.setDate(thirty.getDate() - 30);
    const sixty = new Date(now);
    sixty.setDate(sixty.getDate() - 60);

    const recent = await prisma.recordExtractedValue.findMany({
      where: { record: { is: { patientId } }, recordDate: { gte: ninety } } as any,
      select: { isAbnormal: true, severity: true, recordDate: true },
    });

    if (recent.length === 0) {
      return { score: null, grade: null, trend: "stable", trackedCount: 0, abnormalCount: 0, normalCount: 0, lastUpdated: null };
    }

    const calcScore = (rows: typeof recent) => {
      if (rows.length === 0) return 100;
      const abnormal = rows.filter((r) => r.isAbnormal);
      const critical = abnormal.filter((r) => r.severity === "CRITICAL").length;
      const moderate = abnormal.filter((r) => r.severity === "MODERATE").length;
      const mild = abnormal.filter((r) => r.severity === "MILD").length;
      const penalty = critical * 15 + moderate * 8 + mild * 3;
      return Math.max(0, Math.min(100, 100 - (penalty / rows.length) * 10 - (abnormal.length / rows.length) * 30));
    };

    const last30 = recent.filter((r) => r.recordDate >= thirty);
    const prior30 = recent.filter((r) => r.recordDate >= sixty && r.recordDate < thirty);
    const scoreNow = calcScore(recent);
    const scoreLast30 = calcScore(last30);
    const scorePrior30 = calcScore(prior30);

    let trend: "improving" | "stable" | "declining" = "stable";
    if (prior30.length > 0) {
      if (scoreLast30 - scorePrior30 >= 5) trend = "improving";
      else if (scorePrior30 - scoreLast30 >= 5) trend = "declining";
    }

    const score = Math.round(scoreNow);
    const grade =
      score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Fair" : "Poor";

    const sortedDates = recent.map((r) => r.recordDate).sort((a, b) => b.getTime() - a.getTime());

    return {
      score,
      grade,
      trend,
      trackedCount: recent.length,
      abnormalCount: recent.filter((r) => r.isAbnormal).length,
      normalCount: recent.filter((r) => !r.isAbnormal).length,
      lastUpdated: sortedDates[0]?.toISOString() ?? null,
    };
  });
}

export async function getSummary(patientId: string) {
  const cacheKey = `analytics:summary:${patientId}`;
  return cached(cacheKey, async () => {
    const all = await prisma.recordExtractedValue.findMany({
      where: { record: { is: { patientId } } } as any,
      orderBy: { recordDate: "asc" },
      select: {
        parameterKey: true, parameterLabel: true, value: true, unit: true,
        referenceMin: true, referenceMax: true, isAbnormal: true, severity: true, recordDate: true,
      },
    });

    const byKey: Record<string, typeof all> = {};
    for (const r of all) {
      if (!byKey[r.parameterKey]) byKey[r.parameterKey] = [];
      byKey[r.parameterKey].push(r);
    }

    const parameters = Object.values(byKey).map((rows) => {
      const latest = rows[rows.length - 1];
      const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
      let trend: "up" | "down" | "stable" = "stable";
      if (prev) {
        const diff = latest.value - prev.value;
        const pct = Math.abs(diff / (prev.value || 1));
        if (pct > 0.03) trend = diff > 0 ? "up" : "down";
      }
      return {
        parameterKey: latest.parameterKey,
        parameterLabel: latest.parameterLabel,
        unit: latest.unit,
        latestValue: latest.value,
        latestDate: latest.recordDate.toISOString().split("T")[0],
        isAbnormal: latest.isAbnormal,
        severity: latest.severity,
        referenceMin: latest.referenceMin,
        referenceMax: latest.referenceMax,
        trend,
        dataPointCount: rows.length,
      };
    });

    parameters.sort((a, b) => {
      if (a.isAbnormal !== b.isAbnormal) return a.isAbnormal ? -1 : 1;
      return b.dataPointCount - a.dataPointCount;
    });

    return { parameters, totalParameters: parameters.length };
  });
}

export async function getAbnormalHistory(patientId: string, from?: string, to?: string) {
  const cacheKey = `analytics:abnormal:${patientId}:${from ?? ""}:${to ?? ""}`;
  return cached(cacheKey, async () => {
    const where: any = { record: { patientId }, isAbnormal: true };
    if (from || to) {
      where.recordDate = {};
      if (from) where.recordDate.gte = new Date(from);
      if (to) where.recordDate.lte = new Date(to);
    }

    const rows = await prisma.recordExtractedValue.findMany({
      where,
      orderBy: { recordDate: "desc" },
      take: 100,
      select: {
        parameterKey: true, parameterLabel: true, value: true, unit: true,
        isAbnormal: true, severity: true, recordDate: true, recordId: true,
        referenceMin: true, referenceMax: true,
      },
    });

    return rows.map((r) => ({
      date: r.recordDate.toISOString().split("T")[0],
      parameterKey: r.parameterKey,
      parameterLabel: r.parameterLabel,
      value: r.value,
      unit: r.unit,
      severity: r.severity,
      recordId: r.recordId,
      referenceMin: r.referenceMin,
      referenceMax: r.referenceMax,
    }));
  });
}
