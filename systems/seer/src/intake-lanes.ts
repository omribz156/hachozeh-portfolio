import type { CanonicalIntakeLane, IntakeLane } from "./contracts";

export function normalizeIntakeLane(value: IntakeLane | string | undefined): CanonicalIntakeLane {
  if (value === "planned" || value === "planned-event") {
    return "planned";
  }

  return "live";
}

export function isPlannedLane(value: IntakeLane | string | undefined): boolean {
  return normalizeIntakeLane(value) === "planned";
}

export function isLiveLane(value: IntakeLane | string | undefined): boolean {
  return normalizeIntakeLane(value) === "live";
}
