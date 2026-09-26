#!/usr/bin/env bash
set -euo pipefail

PACK=""
FROM_PATH=""
TO_PATH=""
DRAFT_ID=""
FORCE="false"

usage() {
  cat <<'EOF'
Usage:
  workspace/scripts/market-pack-promote.sh --pack <pack-name> [options]

Options:
  --pack <name>              Market pack folder under workspace/market-packs.
  --from <path>              Source dev snapshot JSON. Defaults to newest 02-dev/*.json.
  --to <path>                Output prod snapshot JSON. Defaults to 03-prod/<pack>-prod.json.
  --draft <draft-id>         Promote only one draft from the snapshot.
  --force                    Overwrite existing output.
  -h, --help                 Show this help.

Purpose:
  Freeze an accepted dev/canonical draft snapshot into the pack's 03-prod folder
  without editing market content. This is a promotion/copy rail, not a rewrite rail.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pack)
      PACK="${2:-}"
      shift 2
      ;;
    --pack=*)
      PACK="${1#--pack=}"
      shift
      ;;
    --from)
      FROM_PATH="${2:-}"
      shift 2
      ;;
    --from=*)
      FROM_PATH="${1#--from=}"
      shift
      ;;
    --to)
      TO_PATH="${2:-}"
      shift 2
      ;;
    --to=*)
      TO_PATH="${1#--to=}"
      shift
      ;;
    --draft)
      DRAFT_ID="${2:-}"
      shift 2
      ;;
    --draft=*)
      DRAFT_ID="${1#--draft=}"
      shift
      ;;
    --force)
      FORCE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PACK" ]]; then
  echo "--pack is required." >&2
  usage >&2
  exit 2
fi

pack_dir="workspace/market-packs/${PACK}"
dev_dir="${pack_dir}/02-dev"
prod_dir="${pack_dir}/03-prod"

if [[ ! -d "$pack_dir" ]]; then
  echo "Pack folder not found: ${pack_dir}" >&2
  exit 2
fi

if [[ -z "$FROM_PATH" ]]; then
  FROM_PATH="$(find "$dev_dir" -maxdepth 1 -type f -name '*.json' -print 2>/dev/null | sort | tail -n 1)"
fi

if [[ -z "$FROM_PATH" || ! -f "$FROM_PATH" ]]; then
  echo "Source snapshot not found. Pass --from <path>." >&2
  exit 2
fi

if [[ -z "$TO_PATH" ]]; then
  TO_PATH="${prod_dir}/market-creation-drafts-${PACK}-prod.json"
fi

if [[ -e "$TO_PATH" && "$FORCE" != "true" ]]; then
  echo "Output already exists: ${TO_PATH} (pass --force to overwrite)" >&2
  exit 2
fi

mkdir -p "$(dirname "$TO_PATH")"

node - "$FROM_PATH" "$TO_PATH" "$PACK" "$DRAFT_ID" <<'NODE'
const fs = require("fs");
const [fromPath, toPath, pack, draftId] = process.argv.slice(2);
const snapshot = JSON.parse(fs.readFileSync(fromPath, "utf8"));
const items = Array.isArray(snapshot.items) ? snapshot.items : [];
const selected = draftId ? items.filter((item) => item.creationDraftId === draftId) : items;
const errors = [];

if (snapshot.objectType !== "market_creation_draft_snapshot") {
  errors.push(`objectType=${snapshot.objectType ?? "missing"}`);
}
if (items.length === 0) {
  errors.push("snapshot has no items");
}
if (draftId && selected.length !== 1) {
  errors.push(`draft not found exactly once: ${draftId}`);
}

for (const item of selected) {
  const prefix = item.creationDraftId ?? item.candidateMarketId ?? "unknown";
  const contract = item.contract ?? {};
  const source = contract.resolutionSource ?? {};
  const timeline = contract.timeline ?? {};
  const eventSlug = item.eventSlug ?? item.event?.slug ?? contract.displayHints?.eventSlug ?? null;
  const outcomeMap = Array.isArray(contract.outcomeMap) ? contract.outcomeMap : [];
  const outcomes = Array.isArray(item.outcomes) ? item.outcomes : [];

  if (!item.creationDraftId) errors.push(`${prefix}: missing creationDraftId`);
  if (!item.title) errors.push(`${prefix}: missing title`);
  if (!eventSlug) errors.push(`${prefix}: missing eventSlug/public URL identity`);
  if (!contract.objectType) errors.push(`${prefix}: missing contract`);
  if (!source.label) errors.push(`${prefix}: missing resolutionSource.label`);
  if (!source.url && !item.trustDisplayUrl) errors.push(`${prefix}: missing user-facing source URL`);
  if (!Array.isArray(source.sourceIds) || source.sourceIds.length === 0) {
    errors.push(`${prefix}: missing resolutionSource.sourceIds`);
  }
  if (!contract.measurementKind) errors.push(`${prefix}: missing measurementKind`);
  if (!contract.resultShape) errors.push(`${prefix}: missing resultShape`);
  if (!contract.oracleCapability) errors.push(`${prefix}: missing oracleCapability`);
  if (contract.oracleCapability === "blocked") errors.push(`${prefix}: oracleCapability=blocked`);
  if (!timeline.closeAt && !item.closeAt) errors.push(`${prefix}: missing closeAt`);
  if (!timeline.expectedResolutionAt) errors.push(`${prefix}: missing expectedResolutionAt`);
  if (outcomes.length > 0 && outcomeMap.length === 0) errors.push(`${prefix}: missing outcomeMap`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const output = {
  ...snapshot,
  snapshotId: `${snapshot.snapshotId || "mcds"}_${pack}_prod_${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}`,
  generatedAt: new Date().toISOString(),
  itemCount: selected.length,
  items: selected
};

fs.writeFileSync(toPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  objectType: "market_pack_promote_receipt",
  pack,
  fromPath,
  toPath,
  itemCount: selected.length,
  draftIds: selected.map((item) => item.creationDraftId)
}, null, 2));
NODE
