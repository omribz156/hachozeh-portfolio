import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";

type Options = {
  event?: string[];
  showGraph?: string | boolean;
  showParentInDiscovery?: string | boolean;
  showChildrenInDiscovery?: string | boolean;
  json?: boolean;
};

function readOptionalBoolean(value: string | boolean | undefined, flagName: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`Flag --${flagName} must be true or false.`);
}

async function run(options: Options): Promise<void> {
  const eventIds = (options.event ?? []).map((eventId) => eventId.trim()).filter(Boolean);

  if (eventIds.length === 0) {
    throw new Error("At least one --event <event-id> is required.");
  }

  const showGraph = readOptionalBoolean(options.showGraph, "show-graph");
  const showParentInDiscovery = readOptionalBoolean(
    options.showParentInDiscovery,
    "show-parent-in-discovery"
  );
  const showChildrenInDiscovery = readOptionalBoolean(
    options.showChildrenInDiscovery,
    "show-children-in-discovery"
  );

  if (
    showGraph === undefined &&
    showParentInDiscovery === undefined &&
    showChildrenInDiscovery === undefined
  ) {
    throw new Error(
      "At least one display flag is required: --show-graph, --show-parent-in-discovery, or --show-children-in-discovery."
    );
  }

  const setFlags: Record<string, boolean> = {};
  const removeFlags: string[] = [];

  if (showGraph === true) {
    setFlags.showGraph = true;
  } else if (showGraph === false) {
    removeFlags.push("showGraph");
  }

  if (showParentInDiscovery !== undefined) {
    setFlags.showParentInDiscovery = showParentInDiscovery;
  }

  if (showChildrenInDiscovery === true) {
    setFlags.showChildrenInDiscovery = true;
  } else if (showChildrenInDiscovery === false) {
    removeFlags.push("showChildrenInDiscovery");
  }

  const pool = createDbPool(loadAppEnv().db);

  try {
    const result = await pool.query<{
      id: string;
      slug: string | null;
      display_flags: Record<string, unknown>;
    }>(
      `
        update events
        set
          display_flags = (coalesce(display_flags, '{}'::jsonb) - $3::text[]) || $2::jsonb,
          updated_at = now()
        where id = any($1::text[])
        returning id, slug, display_flags
      `,
      [eventIds, JSON.stringify(setFlags), removeFlags]
    );

    const missing = eventIds.filter((eventId) => !result.rows.some((row) => row.id === eventId));
    const payload = {
      objectType: "event_display_flags_update",
      updated: result.rowCount ?? 0,
      requestedEventIds: eventIds,
      missingEventIds: missing,
      rows: result.rows
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`updated: ${payload.updated}`);
      for (const row of payload.rows) {
        console.log(`- ${row.id} ${row.slug ?? ""} ${JSON.stringify(row.display_flags)}`);
      }
      if (missing.length > 0) {
        console.log(`missing: ${missing.join(", ")}`);
      }
    }

    if (missing.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

const program = new Command("set-event-display-flags")
  .description("Update event display flags such as showGraph and discovery visibility.")
  .option("--show-graph <true|false>")
  .option("--show-parent-in-discovery <true|false>")
  .option("--show-children-in-discovery <true|false>")
  .option("--event <event-id>", "Event id to update; repeatable.", (value, previous: string[] = []) => [
    ...previous,
    value
  ])
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
