import type {
  MarketContractImage,
  MarketImageBucket,
  ProposedOutcome,
  SourceRolePlan
} from "./contracts";
import {
  readMarketVisualAssetByCategory,
  readMarketVisualAssetById,
  type MarketVisualAsset
} from "./market-visual-registry";

type CurateMarketImageInput = {
  question: string;
  category?: string | null;
  sourceIds?: string[];
  sourceRolePlan?: SourceRolePlan;
  suggestedResolutionAnchor?: string;
  proposedOutcomes?: ProposedOutcome[];
};

type ImageCandidate = Omit<MarketContractImage, "bucket"> & {
  bucket: MarketImageBucket;
  match(input: CurateMarketImageInput, haystack: string): boolean;
};

function imageFromAsset(assetId: string): Pick<MarketContractImage, "assetId" | "src" | "rights" | "theme"> {
  const asset = readMarketVisualAssetById(assetId);

  if (!asset) {
    throw new Error(`Missing market visual asset: ${assetId}`);
  }

  return {
    assetId: asset.assetId,
    src: asset.path,
    rights: asset.rights as MarketContractImage["rights"],
    theme: asset.theme
  };
}

const BUCKET_PRIORITY: Record<MarketImageBucket, number> = {
  entity: 0,
  event: 1,
  source: 2,
  "category-fallback": 3
};

function sourceIdsInclude(input: CurateMarketImageInput, sourceId: string): boolean {
  return input.sourceIds?.includes(sourceId) ?? false;
}

function buildHaystack(input: CurateMarketImageInput): string {
  return [
    input.question,
    input.category,
    input.suggestedResolutionAnchor,
    ...(input.sourceIds ?? []),
    ...(input.sourceRolePlan?.wake ?? []),
    ...(input.sourceRolePlan?.ground ?? []),
    ...(input.sourceRolePlan?.resolve ?? []),
    ...(input.proposedOutcomes ?? []).map((outcome) => outcome.label)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const IMAGE_CANDIDATES: ImageCandidate[] = [
  {
    bucket: "entity",
    ...imageFromAsset("bucket.crypto.default.v1"),
    alt: "ביטקוין",
    provenance: "entity:bitcoin",
    match: (_input, haystack) => /bitcoin|btc|ביטקוין/.test(haystack)
  },
  {
    bucket: "entity",
    ...imageFromAsset("bucket.crypto.default.v1"),
    alt: "אתריום",
    provenance: "entity:ethereum",
    match: (_input, haystack) => /ethereum|ether|eth|אתריום/.test(haystack)
  },
  {
    bucket: "entity",
    ...imageFromAsset("bucket.crypto.default.v1"),
    alt: "סולנה",
    provenance: "entity:solana",
    match: (_input, haystack) => /solana|sol\b|סולנה/.test(haystack)
  },
  {
    bucket: "entity",
    ...imageFromAsset("bucket.crypto.default.v1"),
    alt: "XRP",
    provenance: "entity:xrp",
    match: (_input, haystack) => /\bxrp\b|ריפל/.test(haystack)
  },
  {
    bucket: "entity",
    ...imageFromAsset("bucket.crypto.default.v1"),
    alt: "BNB",
    provenance: "entity:bnb",
    match: (_input, haystack) => /\bbnb\b|binance coin|ביננס/.test(haystack)
  },
  {
    bucket: "entity",
    ...imageFromAsset("bucket.crypto.default.v1"),
    alt: "דוג׳קוין",
    provenance: "entity:dogecoin",
    match: (_input, haystack) => /dogecoin|doge|דוג/.test(haystack)
  },
  {
    bucket: "entity",
    ...imageFromAsset("bucket.sports.default.v1"),
    alt: "קליבלנד קאבלירס",
    provenance: "entity:nba-cleveland-cavaliers",
    match: (_input, haystack) => /cleveland|cavaliers|קליבלנד|קאבלירס/.test(haystack)
  },
  {
    bucket: "entity",
    ...imageFromAsset("bucket.sports.default.v1"),
    alt: "טורונטו ראפטורס",
    provenance: "entity:nba-toronto-raptors",
    match: (_input, haystack) => /toronto|raptors|טורונטו|ראפטורס/.test(haystack)
  },
  // BOI remains an entity-level match so it beats generic source/category
  // routing. The registry currently points it at the owned economy SVG.
  {
    bucket: "entity",
    ...imageFromAsset("entity.bank-of-israel.v1"),
    alt: "בנק ישראל",
    provenance: "entity:bank-of-israel",
    match: (input, haystack) => sourceIdsInclude(input, "src_boi_announcements") || /bank of israel|בנק ישראל/.test(haystack)
  },
  // The `source` bucket was retired 2026-05-30. Markets that previously fell
  // back to source.svg (IMS / Coinbase / NBA) now route to their category
  // bucket (weather / crypto / sports) — the "this resolves via an external
  // authority's announcement" signal was invisible to users and the generic
  // shield icon didn't carry meaningful information at thumb size. When a
  // specific source deserves its own visual (e.g. an NBA market with a
  // stylized hoop, a Coinbase market with a "C"), add it as an entity asset
  // with rights-clean assets, not as a generic source bucket entry.
  // MarketImageBucket type still includes "source" for legacy contract parsing.
  {
    bucket: "event",
    ...imageFromAsset("bucket.weather.default.v1"),
    alt: "מזג אוויר בתל אביב",
    provenance: "event:weather-city",
    match: (_input, haystack) => /weather|מזג|טמפרטורה|תל אביב|תל-אביב/.test(haystack)
  },
  {
    bucket: "event",
    ...imageFromAsset("bucket.sports.default.v1"),
    alt: "משחק ספורט",
    provenance: "event:sports-match",
    match: (input, haystack) =>
      (input.category === "sports" || haystack.includes("ספורט")) &&
      / נגד | vs | v |מי תנצח|תוצאה רשמית|match|game/.test(haystack)
  },
  // FX event matcher — catches currency-pair markets regardless of how the
  // operator categorized them. Stated category often defaults to "economics"
  // for macro markets, which would otherwise route us to economy.svg; the FX
  // bucket SVG ($ ↔ ₪) is the right visual for a שער הדולר market.
  {
    bucket: "event",
    ...imageFromAsset("bucket.fx.default.v1"),
    alt: "שוק מטבע",
    provenance: "event:fx-currency",
    match: (_input, haystack) =>
      /usd\/ils|ils\/usd|eur\/ils|usd\/eur|\bfx\b|forex|מט"?ח|מטבע חוץ|שער (ה)?דולר|שער (ה)?יורו|שער (ה)?שקל/.test(haystack)
  }
];

function fallbackFromAsset(asset: MarketVisualAsset, category: string | null | undefined): MarketContractImage {
  const normalized = category?.trim().toLowerCase() ?? "";

  return {
    bucket: "category-fallback",
    assetId: asset.assetId,
    src: asset.path,
    alt: asset.label,
    provenance: `category_fallback:${normalized || asset.canonicalCategory}`,
    rights: asset.rights as MarketContractImage["rights"],
    theme: asset.theme,
    notes: ["No entity, event, or source image matched; using category fallback."]
  };
}

function fallbackForCategory(category: string | null | undefined): MarketContractImage {
  const asset = readMarketVisualAssetByCategory(category) ?? readMarketVisualAssetByCategory("economics");

  if (!asset) {
    throw new Error("Missing default economics market visual asset");
  }

  return fallbackFromAsset(asset, category);
}

export function curateMarketImage(input: CurateMarketImageInput): MarketContractImage {
  const haystack = buildHaystack(input);
  const candidate = IMAGE_CANDIDATES
    .filter((item) => item.match(input, haystack))
    .sort((left, right) => BUCKET_PRIORITY[left.bucket] - BUCKET_PRIORITY[right.bucket])[0];

  if (candidate) {
    return {
      bucket: candidate.bucket,
      assetId: candidate.assetId,
      src: candidate.src,
      alt: candidate.alt,
      provenance: candidate.provenance,
      rights: candidate.rights,
      theme: candidate.theme
    };
  }

  return fallbackForCategory(input.category);
}
