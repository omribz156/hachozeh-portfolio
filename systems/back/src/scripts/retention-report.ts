// Retention read model (Milestone 0). Computes the activation funnel and
// return-day (D1/D7) retention from retention_events + retention_active_days.
// Run: npm run retention:report  (with the private-ops env loaded)
import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";

async function main(): Promise<void> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);
  try {
    // Activation funnel — cohort = users created since instrumentation began.
    const funnel = await pool.query<{ signups: string; activated: string }>(`
      select
        count(*) as signups,
        count(*) filter (where exists (
          select 1 from retention_events f
          where f.user_id = s.user_id and f.event = 'first_loop_complete'
        )) as activated
      from retention_events s
      where s.event = 'signup'
    `);

    // Return-day retention: of each day's signups, how many were active on +1 / +7.
    const cohorts = await pool.query<{ cohort_day: string; signups: string; d1: string; d7: string }>(`
      with cohorts as (
        select user_id, (created_at at time zone 'Asia/Jerusalem')::date as cohort_day
        from retention_events
        where event = 'signup'
      )
      select
        c.cohort_day,
        count(*) as signups,
        count(*) filter (where exists (
          select 1 from retention_active_days a
          where a.user_id = c.user_id and a.day_date = c.cohort_day + 1
        )) as d1,
        count(*) filter (where exists (
          select 1 from retention_active_days a
          where a.user_id = c.user_id and a.day_date = c.cohort_day + 7
        )) as d7
      from cohorts c
      group by c.cohort_day
      order by c.cohort_day desc
      limit 30
    `);

    // Plumbing sanity — raw signal counts.
    const events = await pool.query<{ event: string; n: number }>(
      `select event, count(*)::int as n from retention_events group by event order by event`
    );
    const active = await pool.query<{ rows: number; users: number; latest: string | null }>(
      `select count(*)::int as rows, count(distinct user_id)::int as users, max(day_date) as latest
       from retention_active_days`
    );

    const f = funnel.rows[0] || { signups: "0", activated: "0" };
    const signups = Number(f.signups);
    const activated = Number(f.activated);
    const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

    console.log("\n=== Retention report ===\n");
    console.log("Activation funnel (cohort = users created since instrumentation):");
    console.log(`  signups:   ${signups}`);
    console.log(`  activated: ${activated}  (${pct(activated, signups)})  — placed first prediction\n`);

    console.log("Return-day retention by cohort:");
    if (!cohorts.rows.length) {
      console.log("  (no signup cohorts yet — accrues as new users sign up)\n");
    } else {
      console.log("  cohort_day    signups   D1           D7");
      for (const r of cohorts.rows) {
        const s = Number(r.signups);
        const d1 = Number(r.d1);
        const d7 = Number(r.d7);
        const cell = (n: number) => `${n} (${pct(n, s)})`.padEnd(11);
        console.log(`  ${String(r.cohort_day).slice(0, 10)}    ${String(s).padStart(5)}   ${cell(d1)}  ${cell(d7)}`);
      }
      console.log("");
    }

    const a = active.rows[0] || { rows: 0, users: 0, latest: null };
    console.log("Raw signals (plumbing check):");
    console.log(`  retention_events: ${events.rows.map((r) => `${r.event}=${r.n}`).join(", ") || "none yet"}`);
    console.log(`  active_days: ${a.rows} rows, ${a.users} distinct users, latest ${a.latest ?? "—"}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
