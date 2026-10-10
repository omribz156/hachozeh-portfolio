const states = new WeakMap<object, { start: number; remaining: number; families: Set<string>; suppressed: number }>();

export function flushRateLimitAuditSummary(owner: object, now = Date.now()): void {
  const state = states.get(owner);
  if (!state || now - state.start < 60_000) return;
  if (state.suppressed) console.info(JSON.stringify({ event: "security.audit.aggregated", windowStart: new Date(state.start).toISOString(), recorded: 20 - state.remaining, suppressed: state.suppressed }));
  states.delete(owner);
}

/** Bound DB writes independently of attacker-controlled IP/path cardinality. */
export function takeRateLimitAuditSlot(owner: object, family: string, now = Date.now()): boolean {
  flushRateLimitAuditSummary(owner, now);
  let state = states.get(owner);
  if (!state) {
    state = { start: now, remaining: 20, families: new Set(), suppressed: 0 };
    states.set(owner, state);
  }
  if (state.remaining <= 0 || state.families.has(family)) { state.suppressed += 1; return false; }
  state.remaining -= 1;
  state.families.add(family);
  return true;
}
