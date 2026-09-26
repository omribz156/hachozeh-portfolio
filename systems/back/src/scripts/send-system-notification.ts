// Operator broadcast of a 'system' notification to every user's bell.
// Run: npm run notify:system -- --key=<unique-key> --message="טקסט ההודעה" [--bold="כותרת"] [--glyph=campaign]
//   (with the private-ops env loaded)
// --key is the dedup token: re-running with the same key never double-sends.
// --message is plain text (HTML-escaped). --bold prepends a bold lead line.
import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { broadcastSystemNotification } from "../notifications/notification-feed-service";

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function main(): Promise<void> {
  const key = readArg("key");
  const message = readArg("message");
  const bold = readArg("bold");
  const glyph = readArg("glyph") ?? undefined;

  if (!key || !message) {
    console.error(
      'usage: npm run notify:system -- --key=<unique-key> --message="..." [--bold="..."] [--glyph=campaign]'
    );
    process.exit(2);
    return;
  }

  const html = `${bold ? `<b>${escapeHtml(bold)}</b> ` : ""}${escapeHtml(message)}`;

  const env = loadAppEnv();
  const pool = createDbPool(env.db);
  try {
    const result = await broadcastSystemNotification(pool, { html, key, thumbGlyph: glyph });
    console.log(
      `system notification "${key}" → ${result.inserted}/${result.recipients} users (already-sent skipped)`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
