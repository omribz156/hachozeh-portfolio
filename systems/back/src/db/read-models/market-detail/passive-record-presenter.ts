import type {
  MarketDetailChainItem,
  MarketDetailPassiveRecord
} from "../../../http/routes/market-detail-fixtures";
import {
  buildMarketLifecycle,
  readContractExpectedResolutionAt,
  readContractMarketImage
} from "../../../shared/market-truth";
import {
  findAssetByAlias,
  readMarketVisualAssetById
} from "../../../shared/market-visual-registry";
import {
  formatCloseLabel,
  formatTimelineLabel,
  formatUpdatedLabel
} from "./formatters";
import {
  buildCurrentPrices,
  buildOutcomes
} from "./outcomes";
import {
  buildMarketContract,
  buildResultSummary,
  buildResolutionSummary,
  buildTrustSummary
} from "./trust-summary";
import type { buildVolumeSummary } from "./volume-summary";
import type { MarketDetailEventUpdate } from "./event-updates-reader";
import type { MarketDetailEventChildrenPayload } from "./event-children-reader";
import type { CategoryMeta, MarketDetailRow } from "./types";

type VolumeSummary = ReturnType<typeof buildVolumeSummary>;
type AliasAsset = NonNullable<ReturnType<typeof findAssetByAlias>>;

function normalizeCategoryKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function canUseAliasRematch(categoryKey: string | null, asset: AliasAsset): boolean {
  if (asset.kind === "category") {
    return true;
  }

  const normalizedCategory = normalizeCategoryKey(categoryKey);

  if (!normalizedCategory) {
    return true;
  }

  return (
    normalizeCategoryKey(asset.canonicalCategory) === normalizedCategory ||
    normalizeCategoryKey(asset.frontendKey) === normalizedCategory
  );
}

function buildTradingMode(rows: MarketDetailRow[]): MarketDetailPassiveRecord["snapshot"]["tradingMode"] {
  return rows.length >= 2 ? "contract_side" : "direct_outcome";
}

function buildGenericTimeline(firstRow: MarketDetailRow): MarketDetailPassiveRecord["snapshot"]["timeline"] {
  const expectedResolutionAt = readContractExpectedResolutionAt(firstRow.market_contract);
  const timeline: MarketDetailPassiveRecord["snapshot"]["timeline"] = [
    {
      title: "פתיחת השוק",
      time: formatTimelineLabel(firstRow.open_at),
      dotClass: "bg-success",
      titleClass: "text-white",
      timeClass: "text-slate-400"
    },
    {
      title: "סגירת השוק",
      time: formatTimelineLabel(firstRow.close_at),
      dotClass: "bg-slate-600",
      titleClass: "text-slate-300",
      timeClass: "text-slate-500"
    }
  ];

  if (expectedResolutionAt) {
    timeline.push({
      title: "הכרעה רשמית",
      time: formatTimelineLabel(new Date(expectedResolutionAt)),
      dotClass: "bg-slate-600",
      titleClass: "text-slate-300",
      timeClass: "text-slate-500"
    });
  }

  timeline.push({
    title: "ביצוע תשלום",
    time: "לאחר הכרעה רשמית",
    dotClass: "bg-slate-600",
    titleClass: "text-slate-300",
    timeClass: "text-slate-500"
  });

  return timeline;
}

export function buildGenericPassiveRecord(
  rows: MarketDetailRow[],
  categoryMeta: CategoryMeta | null,
  chain: MarketDetailChainItem[],
  volumeSummary: VolumeSummary,
  eventUpdates: MarketDetailEventUpdate[] = [],
  eventChildren: MarketDetailEventChildrenPayload = null
): MarketDetailPassiveRecord {
  const [firstRow] = rows;
  const currentPrices = buildCurrentPrices(rows);
  const result = buildResultSummary(firstRow);

  // Image resolution — same ladder as discovery/feed/presenter.ts:
  //   1. Contract has an explicit non-bucket src (operator-curated URL) →
  //      trust verbatim; hydrate photoSrc from registry by assetId if present.
  //   2. Alias rematch — find a more specific asset by title (entity > event
  //      > source > category). Wins for both src AND photoSrc. Handles
  //      stale/generic stamps and missing contract images.
  //   3. Contract has a generic bucket SVG but no alias matched anything more
  //      specific → keep what Seer stamped.
  //   4. Category bucket fallback via categoryMeta.
  //   5. null — frontend renders a placeholder.
  //
  // Photos are display state, not contract state — updating the registry
  // updates every existing market with no contract re-stamp.
  const contractImage = readContractMarketImage(firstRow.market_contract);
  const isBucketContract =
    Boolean(contractImage) &&
    contractImage!.src.startsWith("/assets/images/market-buckets/");

  let brandImageUrl: string | null = null;
  let brandAlt = "Navi";
  let brandPhotoUrl: string | null = null;

  if (contractImage && !isBucketContract) {
    // Operator-explicit image, trust verbatim. Photo from registry by assetId.
    const asset = contractImage.assetId
      ? readMarketVisualAssetById(contractImage.assetId)
      : null;
    brandImageUrl = contractImage.src;
    brandAlt = contractImage.alt;
    brandPhotoUrl = asset?.photoPath ?? null;
  } else {
    const rematched = findAssetByAlias(firstRow.title);
    if (rematched && canUseAliasRematch(firstRow.category_key, rematched)) {
      brandImageUrl = rematched.path;
      brandAlt = contractImage?.alt ?? rematched.label;
      brandPhotoUrl = rematched.photoPath ?? null;
    } else if (contractImage) {
      brandImageUrl = contractImage.src;
      brandAlt = contractImage.alt;
    } else if (categoryMeta) {
      brandImageUrl = categoryMeta.brandImageUrl;
      brandAlt = categoryMeta.brandAlt;
    }
  }

  return {
    context: {
      sectionLabel: "שווקים",
      categoryLabel: categoryMeta?.label ?? "שווקים",
      categoryHref: categoryMeta?.href ?? "/trending",
      marketLabel: firstRow.title,
      publicPath: firstRow.event_slug ? `/event/${encodeURIComponent(firstRow.event_slug)}` : null,
      brandAlt,
      brandImageUrl,
      brandPhotoUrl
    },
    snapshot: {
      marketStatus: firstRow.market_status,
      tradingMode: buildTradingMode(rows),
      settlementStatus: result.settlementStatus,
      resolvedAt: result.resolvedAt,
      winner: result.winner,
      result,
      ...(eventChildren
        ? {
            event: eventChildren.event,
            children: eventChildren.children
          }
        : {}),
      eventUpdates,
      lifecycle: buildMarketLifecycle(firstRow),
      updatedLabel: formatUpdatedLabel(firstRow.updated_at),
      marketStateVersion: Number(firstRow.market_state_version),
      volumeLabel: volumeSummary.totalVolumeLabel,
      closeLabel: formatCloseLabel(firstRow.close_at),
      current: currentPrices,
      outcomes: buildOutcomes(rows),
      resolution: buildResolutionSummary(firstRow),
      trust: buildTrustSummary(firstRow),
      contract: buildMarketContract(firstRow),
      outcomeVolumes: volumeSummary.outcomeVolumes,
      rulesLead:
        firstRow.description ??
        "שוק backend ראשוני. ציר הזמן והמחירים יחודדו ככל שה-read models יתבגרו.",
      relatedMarkets: [],
      timeline: buildGenericTimeline(firstRow)
    },
    chain
  };
}

export function mergeFixturePassiveRecord(
  fixtureRecord: MarketDetailPassiveRecord,
  rows: MarketDetailRow[],
  categoryMeta: CategoryMeta | null,
  chain: MarketDetailChainItem[],
  volumeSummary: VolumeSummary,
  eventUpdates: MarketDetailEventUpdate[] = [],
  eventChildren: MarketDetailEventChildrenPayload = null
): MarketDetailPassiveRecord {
  const [firstRow] = rows;
  const result = buildResultSummary(firstRow);
  const { timeframes: _legacyTimeframes, ...fixtureSnapshot } = fixtureRecord.snapshot;

  return {
    context: {
      ...fixtureRecord.context,
      categoryLabel: categoryMeta?.label ?? fixtureRecord.context.categoryLabel,
      categoryHref: categoryMeta?.href ?? fixtureRecord.context.categoryHref,
      marketLabel: firstRow.title,
      publicPath: firstRow.event_slug ? `/event/${encodeURIComponent(firstRow.event_slug)}` : null
    },
    snapshot: {
      ...fixtureSnapshot,
      marketStatus: firstRow.market_status,
      tradingMode: buildTradingMode(rows),
      settlementStatus: result.settlementStatus,
      resolvedAt: result.resolvedAt,
      winner: result.winner,
      result,
      ...(eventChildren
        ? {
            event: eventChildren.event,
            children: eventChildren.children
          }
        : {}),
      eventUpdates,
      lifecycle: buildMarketLifecycle(firstRow),
      updatedLabel: formatUpdatedLabel(firstRow.updated_at),
      marketStateVersion: Number(firstRow.market_state_version),
      volumeLabel: volumeSummary.totalVolumeLabel,
      closeLabel: formatCloseLabel(firstRow.close_at),
      resolution: buildResolutionSummary(firstRow),
      trust: buildTrustSummary(firstRow),
      contract: buildMarketContract(firstRow),
      outcomes: buildOutcomes(rows),
      outcomeVolumes: volumeSummary.outcomeVolumes,
      current: {
        ...fixtureRecord.snapshot.current,
        ...buildCurrentPrices(rows)
      }
    },
    chain
  };
}
