import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";

type Surface = "hero" | "trending";
type TargetType = "market" | "event";

type Options = {
  surface?: Surface;
  position?: string;
  market?: string;
  event?: string;
  note?: string;
  startsAt?: string;
  endsAt?: string;
  configure?: boolean;
  maxItems?: string;
  fill?: string;
  clearSettings?: boolean;
  disable?: boolean;
  clear?: boolean;
  json?: boolean;
};

function readPosition(value: string | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("--position must be a positive integer.");
  }
  return parsed;
}

function readTimestamp(value: string | undefined, flag: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`--${flag} must be a valid timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function readMaxItems(value: string | undefined): number | null {
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("--max-items must be a positive integer.");
  }

  return parsed;
}

function readBoolean(value: string | undefined, flag: string): boolean | null {
  if (!value) return null;

  if (value === "true") return true;
  if (value === "false") return false;

  throw new Error(`--${flag} must be true or false.`);
}

function readTarget(options: Options): { targetType: TargetType; targetKey: string } {
  const market = options.market?.trim();
  const event = options.event?.trim();

  if (market && event) {
    throw new Error("Use only one target: --market or --event.");
  }

  if (market) {
    return { targetType: "market", targetKey: market };
  }

  if (event) {
    return { targetType: "event", targetKey: event };
  }

  throw new Error("A target is required: --market <market-key> or --event <event-key-or-slug>.");
}

async function run(options: Options): Promise<void> {
  if (!options.surface) {
    throw new Error("--surface is required: hero or trending.");
  }

  const pool = createDbPool(loadAppEnv().db);

  try {
    if (options.configure || options.clearSettings) {
      if (options.surface !== "hero") {
        throw new Error("Curation settings are currently supported only for --surface hero.");
      }
      if (options.position || options.market || options.event || options.clear || options.disable) {
        throw new Error("Use settings options separately from slot target options.");
      }

      if (options.clearSettings) {
        const result = await pool.query(
          `
            delete from discovery_curation_settings
            where surface = $1
          `,
          [options.surface]
        );
        const payload = {
          objectType: "discovery_curation_settings_clear",
          surface: options.surface,
          deleted: result.rowCount ?? 0
        };
        console.log(options.json ? JSON.stringify(payload, null, 2) : `settings deleted: ${payload.deleted}`);
        return;
      }

      const maxItems = readMaxItems(options.maxItems);
      const fill = readBoolean(options.fill, "fill");
      if (maxItems === null && fill === null && !options.note?.trim()) {
        throw new Error("Pass --max-items, --fill, or --note with --configure.");
      }

      const result = await pool.query(
        `
          insert into discovery_curation_settings (
            surface,
            max_items,
            fill,
            note
          )
          values ($1, $2, $3, $4)
          on conflict (surface)
          do update set
            max_items = coalesce(excluded.max_items, discovery_curation_settings.max_items),
            fill = coalesce(excluded.fill, discovery_curation_settings.fill),
            note = coalesce(excluded.note, discovery_curation_settings.note),
            updated_at = now()
          returning surface, max_items, fill, note
        `,
        [
          options.surface,
          maxItems,
          fill,
          options.note?.trim() || null
        ]
      );
      const payload = {
        objectType: "discovery_curation_settings",
        row: result.rows[0] ?? null
      };
      console.log(options.json ? JSON.stringify(payload, null, 2) : JSON.stringify(payload.row));
      return;
    }

    const position = readPosition(options.position);

    if (options.clear) {
      const result = await pool.query(
        `
          delete from discovery_curation_slots
          where surface = $1 and position = $2
        `,
        [options.surface, position]
      );
      const payload = {
        objectType: "discovery_curation_clear",
        surface: options.surface,
        position,
        deleted: result.rowCount ?? 0
      };
      console.log(options.json ? JSON.stringify(payload, null, 2) : `deleted: ${payload.deleted}`);
      return;
    }

    if (options.disable) {
      const result = await pool.query(
        `
          update discovery_curation_slots
          set enabled = false, updated_at = now()
          where surface = $1 and position = $2
          returning surface, position, target_type, target_key, enabled
        `,
        [options.surface, position]
      );
      const payload = {
        objectType: "discovery_curation_disable",
        surface: options.surface,
        position,
        updated: result.rowCount ?? 0,
        rows: result.rows
      };
      console.log(options.json ? JSON.stringify(payload, null, 2) : `disabled: ${payload.updated}`);
      return;
    }

    const target = readTarget(options);
    const startsAt = readTimestamp(options.startsAt, "starts-at");
    const endsAt = readTimestamp(options.endsAt, "ends-at");
    const result = await pool.query(
      `
        insert into discovery_curation_slots (
          surface,
          position,
          target_type,
          target_key,
          enabled,
          starts_at,
          ends_at,
          note
        )
        values ($1, $2, $3, $4, true, $5, $6, $7)
        on conflict (surface, position)
        do update set
          target_type = excluded.target_type,
          target_key = excluded.target_key,
          enabled = true,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          note = excluded.note,
          updated_at = now()
        returning surface, position, target_type, target_key, enabled, starts_at, ends_at, note
      `,
      [
        options.surface,
        position,
        target.targetType,
        target.targetKey,
        startsAt,
        endsAt,
        options.note?.trim() || null
      ]
    );
    const payload = {
      objectType: "discovery_curation_slot",
      row: result.rows[0] ?? null
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else if (payload.row) {
      console.log(
        `${payload.row.surface} #${payload.row.position}: ${payload.row.target_type}:${payload.row.target_key}`
      );
    }
  } finally {
    await pool.end();
  }
}

const program = new Command("set-discovery-curation")
  .description("Pin markets or events into discovery hero/trending slots.")
  .requiredOption("--surface <hero|trending>")
  .option("--position <n>")
  .option("--market <market-key>")
  .option("--event <event-key-or-slug>")
  .option("--note <text>")
  .option("--starts-at <timestamp>")
  .option("--ends-at <timestamp>")
  .option("--configure")
  .option("--max-items <n>")
  .option("--fill <true|false>")
  .option("--clear-settings")
  .option("--disable")
  .option("--clear")
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
