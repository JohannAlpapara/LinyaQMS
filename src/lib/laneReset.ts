import { prisma } from './prisma';

let lastResetDate: string | null = null;

export async function resetLaneNumbersOncePerDay(options?: { force?: boolean }) {
  const forceReset = options?.force === true;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (!forceReset && lastResetDate === today) return;

  // Check if already reset today (in case of multiple serverless instances)
  if (!forceReset) {
    const setting = await prisma.setting.findUnique({ where: { key: 'lastLaneReset' } });
    if (setting?.value === today) {
      lastResetDate = today;
      return;
    }
  }

  // For a manual (forced) reset, wipe all today's queue items so
  // numbering restarts from 1 and lane numbers are fully cleared.
  if (forceReset) {
    const queueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await prisma.queueItem.deleteMany({
      where: { queueDate },
    });
  }

  await prisma.lane.updateMany({ data: { currentNumber: 0, lastServedNumber: 0 } });
  await prisma.setting.upsert({
    where: { key: 'lastLaneReset' },
    update: { value: today },
    create: { key: 'lastLaneReset', value: today },
  });
  lastResetDate = today;
  console.log(`✅ All lane currentNumber values reset to 0 for ${today}${forceReset ? ' (manual)' : ''}`);
}
