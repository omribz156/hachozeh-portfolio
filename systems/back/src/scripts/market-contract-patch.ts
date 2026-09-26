import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { readStringArg } from "./script-args";

type Options = {
  market?: string[];
  marketIds?: string[];
  replaceFrom?: string;
  replaceTo?: string;
  requireSourceId?: string;
  requireStatus?: string;
  requireCloseDate?: string;
  execute?: boolean;
  json?: boolean;
};

type MarketRow = {
  id: string;
  status: string;
  close_at: Date;
  market_contract_text: string;
  oracle_source_policy_text: string;
};

type ContractPatchPreview = {
  id: string;
  target: "market_contract" | "oracle_source_policy";
  beforeSnippet: string;
  afterSnippet: string;
};

function repeated(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function readMarkets(options: Options): string[] {
  return [...new Set([...(options.marketIds ?? []), ...(options.market ?? [])].map((market) => market.trim()).filter(Boolean))];
}

function requireText(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
}

function closeDate(row: MarketRow): string {
  return row.close_at.toISOString().slice(0, 10);
}

function previewReplacement(id: string, target: ContractPatchPreview["target"], text: string, replaceFrom: string, replaceTo: string): ContractPatchPreview | null {
  const index = text.indexOf(replaceFrom);
  if (index < 0) return null;
  const beforeStart = Math.max(0, index - 120);
  const beforeEnd = Math.min(text.length, index + replaceFrom.length + 120);
  const afterText = text.slice(0, index) + replaceTo + text.slice(index + replaceFrom.length);
  const afterEnd = Math.min(afterText.length, index + replaceTo.length + 120);
  return {
    id,
    target,
    beforeSnippet: text.slice(beforeStart, beforeEnd),
    afterSnippet: afterText.slice(beforeStart, afterEnd)
  };
}

function buildPreviews(rows: MarketRow[], replaceFrom: string, replaceTo: string): ContractPatchPreview[] {
  return rows.flatMap((row) =>
    [
      previewReplacement(row.id, "market_contract", row.market_contract_text, replaceFrom, replaceTo),
      previewReplacement(row.id, "oracle_source_policy", row.oracle_source_policy_text, replaceFrom, replaceTo)
    ].filter((item): item is ContractPatchPreview => Boolean(item))
  );
}

function validateRows(rows: MarketRow[], marketIds: string[], options: Required<Pick<Options, "replaceFrom" | "replaceTo">> & Options): string[] {
  const errors: string[] = [];
  const foundIds = new Set(rows.map((row) => row.id));

  for (const marketId of marketIds) {
    if (!foundIds.has(marketId)) {
      errors.push(`${marketId}: market_not_found`);
    }
  }

  for (const row of rows) {
    const combined = `${row.market_contract_text}\n${row.oracle_source_policy_text}`;
    if (options.requireStatus && row.status !== options.requireStatus) {
      errors.push(`${row.id}: status=${row.status}, expected=${options.requireStatus}`);
    }
    if (options.requireCloseDate && closeDate(row) !== options.requireCloseDate) {
      errors.push(`${row.id}: closeDate=${closeDate(row)}, expected=${options.requireCloseDate}`);
    }
    if (options.requireSourceId && !combined.includes(options.requireSourceId)) {
      errors.push(`${row.id}: missing required source id ${options.requireSourceId}`);
    }
    if (!combined.includes(options.replaceFrom)) {
      errors.push(`${row.id}: replaceFrom not present`);
    }
    if (combined.includes(options.replaceTo)) {
      errors.push(`${row.id}: replaceTo already present`);
    }
  }

  return errors;
}

async function run(options: Options): Promise<void> {
  const marketIds = readMarkets(options);
  if (marketIds.length === 0) {
    throw new Error("At least one --market is required.");
  }

  const replaceFrom = requireText(options.replaceFrom, "--replace-from");
  const replaceTo = requireText(options.replaceTo, "--replace-to");
  const pool = createDbPool(loadAppEnv().db);

  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const rows = (
        await client.query<MarketRow>(
          `
            select
              id,
              status,
              close_at,
              market_contract::text as market_contract_text,
              oracle_source_policy::text as oracle_source_policy_text
            from markets
            where id = any($1::text[])
            order by id
            for update
          `,
          [marketIds]
        )
      ).rows;

      const normalizedOptions = { ...options, replaceFrom, replaceTo };
      const errors = validateRows(rows, marketIds, normalizedOptions);
      if (errors.length > 0) {
        await client.query("rollback");
        const receipt = {
          objectType: "market_contract_patch",
          status: "blocked",
          dryRun: !options.execute,
          requestedMarketIds: marketIds,
          errors
        };
        console.log(JSON.stringify(receipt, null, 2));
        process.exitCode = 2;
        return;
      }

      let afterRows = rows;
      if (options.execute) {
        afterRows = (
          await client.query<MarketRow>(
            `
              update markets
              set
                market_contract = replace(market_contract::text, $2, $3)::jsonb,
                oracle_source_policy = replace(oracle_source_policy::text, $2, $3)::jsonb,
                updated_at = now()
              where id = any($1::text[])
              returning
                id,
                status,
                close_at,
                market_contract::text as market_contract_text,
                oracle_source_policy::text as oracle_source_policy_text
            `,
            [marketIds, replaceFrom, replaceTo]
          )
        ).rows;
      }

      const postErrors = options.execute
        ? afterRows.flatMap((row) => {
            const combined = `${row.market_contract_text}\n${row.oracle_source_policy_text}`;
            const rowErrors: string[] = [];
            if (combined.includes(replaceFrom)) rowErrors.push(`${row.id}: old value still present`);
            if (!combined.includes(replaceTo)) rowErrors.push(`${row.id}: new value missing`);
            return rowErrors;
          })
        : [];

      if (postErrors.length > 0) {
        await client.query("rollback");
        throw new Error(postErrors.join("; "));
      }

      if (options.execute) {
        await client.query("commit");
      } else {
        await client.query("rollback");
      }

      const receipt = {
        objectType: "market_contract_patch",
        status: options.execute ? "patched" : "dry_run",
        dryRun: !options.execute,
        requestedMarketIds: marketIds,
        patchedCount: options.execute ? afterRows.length : 0,
        replaceFrom,
        replaceTo,
        previews: buildPreviews(rows, replaceFrom, replaceTo),
        rows: afterRows.map((row) => {
          const combined = `${row.market_contract_text}\n${row.oracle_source_policy_text}`;
          return {
            id: row.id,
            status: row.status,
            closeDate: closeDate(row),
            hasReplaceFrom: combined.includes(replaceFrom),
            hasReplaceTo: combined.includes(replaceTo)
          };
        })
      };

      console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

function readPayload(args = process.argv.slice(2)): Partial<Options> {
  const raw = readStringArg(args, "payload-json-b64", "").trim();
  if (!raw) {
    return {};
  }

  const decoded = Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(decoded) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--payload-json-b64 must decode to a JSON object.");
  }

  return parsed as Partial<Options>;
}

const program = new Command("market-contract-patch")
  .description("Guarded JSON text replacement for live market_contract/oracle_source_policy rows.")
  .option("--market <market-id>", "Exact market id; repeatable.", repeated)
  .requiredOption("--replace-from <text>")
  .requiredOption("--replace-to <text>")
  .option("--require-source-id <source-id>")
  .option("--require-status <status>")
  .option("--require-close-date <yyyy-mm-dd>")
  .option("--payload-json-b64 <base64-json>", "Base64 JSON payload for compact Render jobs.")
  .option("--execute", "Apply the patch. Default is dry-run.")
  .option("--json")
  .action((options: Options) => run({ ...options, ...readPayload() }));

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
