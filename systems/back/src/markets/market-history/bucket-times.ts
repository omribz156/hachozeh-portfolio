function ceilTimestampToStep(timestampMs: number, stepMs: number): number {
  const safeStepMs = Math.max(1, stepMs);

  return Math.ceil(timestampMs / safeStepMs) * safeStepMs;
}

export function buildClockAlignedBucketTimes(
  startMs: number,
  endMs: number,
  resolutionSeconds: number
): number[] {
  const resolutionMs = Math.max(1, resolutionSeconds) * 1000;
  const safeEndMs = Math.max(startMs, endMs);
  const bucketTimes: number[] = [];

  for (
    let bucketMs = ceilTimestampToStep(startMs, resolutionMs);
    bucketMs <= safeEndMs;
    bucketMs += resolutionMs
  ) {
    bucketTimes.push(bucketMs);
  }

  if (!bucketTimes.length || bucketTimes.at(-1) !== safeEndMs) {
    bucketTimes.push(safeEndMs);
  }

  return bucketTimes;
}
