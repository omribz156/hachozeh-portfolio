(function () {
  // Resolve the formatters LIVE on every access, not once at eval time. Under Astro
  // ClientRouter the sibling scripts (formatters.js / view-model.js) are re-injected
  // async + in parallel on soft-nav, so this IIFE can run BEFORE formatters.js defines
  // window.NaviPortfolioFormatters. Capturing it once froze `f` as undefined and threw
  // `f.toNumber` deep in buildFromBackend (the "התיק לא נטען" error). By the time any of
  // these functions actually runs (after the async data fetch) the formatters exist.
  const f = new Proxy({}, { get: function (_t, key) { return window.NaviPortfolioFormatters?.[key]; } });
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const HEBREW_DAY_NAMES = [
    "ביום ראשון",
    "ביום שני",
    "ביום שלישי",
    "ביום רביעי",
    "ביום חמישי",
    "ביום שישי",
    "ביום שבת",
  ];
  const MARKET_BUCKET_IMAGE_BY_KEY = {
    politics: "/assets/images/market-buckets/politics.svg",
    sports: "/assets/images/market-buckets/sports.svg",
    weather: "/assets/images/market-buckets/weather.svg",
    economy: "/assets/images/market-buckets/economy.svg",
    crypto: "/assets/images/market-buckets/crypto.svg",
    technology: "/assets/images/market-buckets/technology.svg",
    entertainment: "/assets/images/market-buckets/entertainment.svg",
    health: "/assets/images/market-buckets/health.svg",
    general: "/assets/images/market-buckets/general.svg",
  };

  function inferMarketBucketImageSrc(title) {
    const text = String(title || "").trim();
    if (!text) return MARKET_BUCKET_IMAGE_BY_KEY.general;

    if (/בחירות|ראש ממשל|ממשלה|כנסת|נתניהו|בנט|ליברמן|איזנקוט/.test(text)) {
      return MARKET_BUCKET_IMAGE_BY_KEY.politics;
    }
    if (/טמפרטור|מזג|גשם|שלג|חום|קור|מעלות|°|אקלים/.test(text)) {
      return MARKET_BUCKET_IMAGE_BY_KEY.weather;
    }
    if (/ נגד |ליגה|כדורגל|כדורסל|מכבי|הפועל|אליצור|ישראל נגד|קוסובו|צ׳כיה|רעננה|נתניה/.test(text)) {
      return MARKET_BUCKET_IMAGE_BY_KEY.sports;
    }
    if (/ריבית|בנק ישראל|מדד המחירים|מדד|דולר|אירו|שקל|חוזים|נדל/.test(text)) {
      return MARKET_BUCKET_IMAGE_BY_KEY.economy;
    }
    if (/ביטקוין|אתריום|קריפטו|מטבע/.test(text)) {
      return MARKET_BUCKET_IMAGE_BY_KEY.crypto;
    }
    if (/AI|בינה מלאכותית|טכנולוג|אייפון|גוגל|אפל|מיקרוסופט/.test(text)) {
      return MARKET_BUCKET_IMAGE_BY_KEY.technology;
    }
    if (/אירוויזיון|סרט|טלוויזיה|מוזיקה|בידור/.test(text)) {
      return MARKET_BUCKET_IMAGE_BY_KEY.entertainment;
    }
    if (/בריאות|קורונה|חיסון|מחלה|רפואה/.test(text)) {
      return MARKET_BUCKET_IMAGE_BY_KEY.health;
    }

    return MARKET_BUCKET_IMAGE_BY_KEY.general;
  }

  function classifyClosingTime(closeAtIso, now = new Date()) {
    if (!closeAtIso) return null;
    const closeAt = new Date(closeAtIso);
    if (Number.isNaN(closeAt.getTime())) return null;

    const delta = closeAt.getTime() - now.getTime();
    if (delta <= 0) return null;
    if (delta > 7 * DAY_MS) return null;

    if (delta < HOUR_MS) {
      const totalSeconds = Math.floor(delta / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const mm = String(minutes).padStart(2, "0");
      const ss = String(seconds).padStart(2, "0");
      return {
        band: "countdown",
        label: `סוגר בעוד ${mm}:${ss}`,
        live: true,
        closeAt: closeAtIso,
      };
    }

    if (delta < DAY_MS) {
      const hours = Math.floor(delta / HOUR_MS);
      const hoursWord = hours === 1 ? "שעה" : "שעות";
      return {
        band: "hours",
        label: `סוגר בעוד ${hours} ${hoursWord}`,
        live: false,
        closeAt: closeAtIso,
      };
    }

    const daysOut = Math.floor(delta / DAY_MS);
    if (daysOut === 1) {
      return { band: "days", label: "סוגר מחר", live: false, closeAt: closeAtIso };
    }
    const dayName = HEBREW_DAY_NAMES[closeAt.getDay()];
    return {
      band: "days",
      label: `סוגר ${dayName}`,
      live: false,
      closeAt: closeAtIso,
    };
  }

  function normalizePosition(raw) {
    const totalPnl = f.toNumber(raw.totalPnl);
    const dayPnl = f.toNumber(raw.dayPnl);
    const costBasis = f.toNumber(raw.costBasis);
    const currentPrice = f.toNumber(raw.currentPrice);
    const currentValue = f.toNumber(raw.currentValue);
    // The שווי column shows the OPEN holding's current value, so its sub-%
    // and tone must describe THAT holding (unrealized = value − cost), NOT
    // lifetime P&L. Using totalPnl folded realized losses from already-sold
    // shares over the *remaining* cost basis → nonsense like −244% on a
    // holding that's only −84% down on what's still held.
    const openPnl = currentValue - costBasis;
    const openPnlPct = costBasis > 0 ? (openPnl / costBasis) * 100 : null;
    const pnlPercent = openPnlPct !== null ? f.formatPercent(openPnlPct) : null;
    // Poly-style value sub: signed amount + unsigned % in parens, e.g.
    // "V₪ +1.94 (38.73%)" / "V₪ -0.06 (2.94%)". Colored by tone in the table.
    const pnlSubLabel =
      openPnlPct !== null
        ? `${f.formatSignedCurrency(openPnl)} (${f.formatPercent(Math.abs(openPnlPct)).replace("+", "")})`
        : null;
    // לזכייה = profit if this resolves favorably: payout (V₪ 1 / contract)
    // minus the cost of the shares still held (Polymarket's "To win").
    const contractCount = f.toNumber(raw.contractCount);
    const toWinProfit = contractCount - costBasis;

    // "אני" — where the user is: their outcome + its current price.
    // Tone reflects winning (>=50%) or behind (<50%).
    const currentStatePercent = Math.round(currentPrice * 100);
    const currentStateLabel = raw.outcomeLabel
      ? `${currentStatePercent}% ${raw.outcomeLabel}`
      : `${currentStatePercent}%`;
    const currentStateTone = currentPrice >= 0.5 ? "buy" : "sell";

    // "השוק" — where the market thinks the resolution is going: the
    // leading outcome + its current price. For binary markets (כן/לא)
    // we can derive the opposite when the user is on the losing side.
    // For multi-outcome, fall back to the percent alone since we don't
    // have the competing outcome label in the fixture/snapshot.
    const binaryOpposite =
      raw.outcomeLabel === "כן" ? "לא" :
      raw.outcomeLabel === "לא" ? "כן" : null;
    const userIsLeading = currentPrice >= 0.5;
    // Prefer the backend's resolved market LEADER (top outcome by price). It names
    // "where the market thinks it's going" for ANY shape — incl. multi-outcome,
    // where 1-price and the binary complement don't apply. Fall back to the binary
    // derivation (complement → כן/לא → percent-only) when the leader is absent.
    const backendLeaderPrice = f.toNumber(raw.leadingOutcomePrice);
    const hasBackendLeader =
      !!raw.leadingOutcomeLabel && Number.isFinite(backendLeaderPrice) && backendLeaderPrice > 0;
    const leaderPrice = hasBackendLeader
      ? backendLeaderPrice
      : (userIsLeading ? currentPrice : 1 - currentPrice);
    const leaderPercent = Math.round(leaderPrice * 100);
    const leaderOutcome = hasBackendLeader
      ? raw.leadingOutcomeLabel
      : (userIsLeading ? raw.outcomeLabel : (raw.binaryComplementOutcomeLabel || binaryOpposite));
    const marketSaysLabel = leaderOutcome
      ? `${leaderPercent}% ${leaderOutcome}`
      : `${leaderPercent}%`;
    const marketSaysTone = "info"; // neutral — this is data, not user state

    return {
      marketKey: raw.marketKey,
      marketTitle: raw.marketTitle,
      marketStatus: raw.marketStatus,
      marketCloseAt: raw.marketCloseAt,
      outcomeLabel: raw.outcomeLabel,
      contractSide: raw.contractSide,
      quantityLabel: f.formatQuantity(f.toNumber(raw.contractCount)),
      // Backend visual registry is authoritative. The title-derived bucket is
      // only a stale-payload guard so already-open portfolio tabs do not stay
      // stuck on initials after the backend learned images.
      imageSrc: raw.image?.src || inferMarketBucketImageSrc(raw.marketTitle),
      averagePriceLabel: f.formatPriceTag(raw.averageEntryPrice),
      currentPriceLabel: f.formatPriceTag(raw.currentPrice),
      currentValueLabel: f.formatCurrency(raw.currentValue),
      costBasisLabel: f.formatCurrency(costBasis),
      // Profit if the position resolves favorably (Polymarket's "To win"):
      // payout (V₪ 1 / contract) − cost of the shares still held.
      toWinLabel: f.formatCurrency(toWinProfit),
      // Raw numeric values, exposed so callers can sort.
      averageEntryPrice: f.toNumber(raw.averageEntryPrice),
      currentPrice,
      currentValue,
      costBasis,
      toWin: toWinProfit,
      totalPnl,
      currentStateLabel,
      currentStateTone,
      marketSaysLabel,
      marketSaysTone,
      pnlLabel: f.formatSignedCurrency(totalPnl),
      pnlPercentLabel: pnlPercent,
      pnlSubLabel,
      pnlTone: openPnl >= 0 ? "buy" : "sell",
      dayPnl: dayPnl,
      dayPnlLabel: f.formatSignedCurrency(dayPnl),
      dayPnlTone: dayPnl >= 0 ? "buy" : "sell",
    };
  }

  // Hebrew sub-eyebrow label per timeframe — gives the PnL card a
  // "what window am I looking at" cue, since the number alone is
  // ambiguous without timeframe context. Used by change-card.js.
  const TIMEFRAME_SUB_EYEBROW = {
    day: "ב-24 שעות",
    week: "ב-7 ימים",
    month: "ב-30 ימים",
    ytd: "מתחילת השנה",
    year: "ב-12 חודשים",
    all: "מתחילת התיק",
  };

  function classifyTone(value) {
    if (value > 0) return "buy";
    if (value < 0) return "sell";
    return "info";
  }

  function buildChangeViewFromFixture(fixture, positions) {
    // Range chip set mirrors Polymarket's portfolio chart (1D / 1W /
    // 1M / 1Y / YTD / ALL) with our Hebrew labels. Backend supplies
    // its own list in production mode (see buildChangeViewFromBackend);
    // this fixture-mode default keeps the chip strip honest when the
    // backend is unavailable.
    const timeframes = [
      { id: "day", label: "יום" },
      { id: "week", label: "שבוע" },
      { id: "month", label: "חודש" },
      { id: "year", label: "שנה" },
      // YTD chip stays Latin — no clean two-character Hebrew abbrev
      // exists for "year-to-date" and "מתחילת השנה" overruns the chip
      // width. The sub-eyebrow expands to the full Hebrew phrase on
      // select, so the meaning lands without the chip being verbose.
      { id: "ytd", label: "YTD" },
      { id: "all", label: "הכל" },
    ];

    // Fixture-mode stub: derive day movement total from dayPnl sum.
    // Real backend mode reads `view.movement.changeAbs` directly.
    const dayTotal = positions.reduce(
      (sum, p) => sum + (Number.isFinite(p.dayPnl) ? p.dayPnl : 0),
      0
    );

    return {
      timeframes,
      activeTimeframeId: "day",
      viewsByTimeframe: {
        day: {
          totalMovementLabel: f.formatSignedCurrency(dayTotal),
          totalMovementTone: classifyTone(dayTotal),
          subEyebrowLabel: TIMEFRAME_SUB_EYEBROW.day,
          pctLabel: null,         // no pct in fixture mode — backend supplies
          contextLabel: null,
          miniStatsLabel: null,
          isZero: dayTotal === 0,
          chartHasData: false,    // fixture mode skips the chart entirely
          chartPoints: [],
        },
        week: null,
        month: null,
        all: null,
      },
    };
  }

  // Chart geometry (path building, autoscale, hover) is owned by
  // HzPnlSparklineRenderer (assets/js/components/pnl-sparkline-renderer.js)
  // per the chart doctrine in practice_chart_creation.md. The view-
  // model only emits the raw time-ordered points + formatters; the
  // renderer projects, scales, paints, and handles hover.

  function buildHistoryDescription(item) {
    if (item.kind === "trade") {
      const intent = `${item.sideLabel} ${item.contractSideLabel}`;
      const qty = f.formatQuantity(item.shareAmount);
      const cash = f.formatCurrency(item.cashAmount);
      const onSuffix = item.outcomeLabel ? ` על ${item.outcomeLabel}` : "";
      return `${intent} של ${qty} ב-${cash}${onSuffix}.`;
    }
    if (item.kind === "settlement") {
      if (item.realizationType === "resolution_win") {
        const proceeds = f.formatCurrency(item.proceeds || 0);
        const onSuffix = item.outcomeLabel ? ` על ${item.outcomeLabel}` : "";
        return `פוזיציה זוכה הוסדרה עם תמורה של ${proceeds}${onSuffix}.`;
      }
      if (item.realizationType === "resolution_loss") {
        const onSuffix = item.outcomeLabel ? ` על ${item.outcomeLabel}` : "";
        return `פוזיציה מפסידה נסגרה${onSuffix}.`;
      }
    }
    return "אירוע בתיק.";
  }

  // Type-chip derivation for the Activity table — maps each event
  // to the chip label + tone the row should carry in the סוג column.
  // The chip vocabulary mirrors the rest of the page so history reads
  // in the same visual register as positions / closing-soon / claims.
  function buildHistoryTypeChip(item) {
    if (item.kind === "trade") {
      // sideLabel arrives as "קנייה" / "מכירה" from fixtures; keep
      // those as chip text and tone them by buy/sell.
      const isBuy = item.sideLabel === "קנייה" || item.sideLabel === "buy";
      return {
        label: isBuy ? "קנייה" : "מכירה",
        tone: isBuy ? "buy" : "sell",
      };
    }
    if (item.kind === "settlement") {
      if (item.realizationType === "resolution_win") {
        return { label: "פדיון", tone: "buy" };
      }
      if (item.realizationType === "resolution_loss") {
        return { label: "הפסד", tone: "sell" };
      }
    }
    // Fallback for unknown kinds — neutral info chip.
    return { label: "אירוע", tone: "info" };
  }

  // Cash amount for the סכום column. Trades carry cashAmount; wins
  // carry proceeds; losses carry no cash so we return 0 (display
  // suppresses the figure for losses, the chip alone carries it).
  function buildHistoryCashAmount(item) {
    if (item.kind === "trade") return f.toNumber(item.cashAmount);
    if (item.kind === "settlement" && item.realizationType === "resolution_win") {
      return f.toNumber(item.proceeds);
    }
    return 0;
  }

  function normalizeHistoryItem(item) {
    const typeChip = buildHistoryTypeChip(item);
    const cashAmount = buildHistoryCashAmount(item);
    return {
      eventId: item.eventId,
      kind: item.kind,
      occurredAt: item.occurredAt,
      marketKey: item.marketKey,
      marketTitle: item.marketTitle,
      // Prose description retained for accessibility / search /
      // mobile fallback. The Activity table itself reads via the
      // typed fields below.
      description: buildHistoryDescription(item),
      // Typed table fields:
      typeChipLabel: typeChip.label,
      typeChipTone: typeChip.tone,
      outcomeChipLabel: item.outcomeLabel || "",
      // Quantity only for trades; settlements don't carry shares.
      quantityLabel: item.kind === "trade" ? f.formatQuantity(item.shareAmount) : "",
      cashAmount,
      // Losses suppress the cash figure (no money changed hands at
      // settlement-time for a losing position — the value already
      // dropped during trading). UI shows "—" in that cell.
      cashLabel:
        item.kind === "settlement" && item.realizationType === "resolution_loss"
          ? "—"
          : f.formatCurrency(cashAmount),
    };
  }

  function normalizeBackendPosition(raw) {
    return normalizePosition({
      marketKey: raw.marketKey,
      marketTitle: raw.marketTitle,
      marketStatus: raw.effectiveMarketStatus || raw.marketStatus,
      marketCloseAt: raw.marketCloseAt,
      outcomeLabel: raw.outcomeLabel,
      binaryComplementOutcomeLabel: raw.binaryComplementOutcomeLabel ?? null,
      leadingOutcomeLabel: raw.leadingOutcomeLabel ?? null,
      leadingOutcomePrice: raw.leadingOutcomePrice ?? null,
      contractSide: raw.contractSide || "yes",
      contractCount: raw.shares,
      averageEntryPrice: raw.averageEntryPrice,
      currentPrice: raw.currentPrice,
      costBasis: raw.costBasis,
      currentValue: raw.positionValue,
      totalPnl: raw.totalPnl,
      dayPnl: raw.dayPnl ?? 0,
    });
  }

  function normalizeBackendHistoryItem(item) {
    if (item.kind === "trade") {
      return normalizeHistoryItem({
        eventId: item.id,
        kind: "trade",
        occurredAt: item.happenedAt,
        marketKey: item.marketKey,
        marketTitle: item.marketTitle,
        sideLabel: item.side === "sell" ? "מכירה" : "קנייה",
        contractSideLabel: item.contractSide === "no" ? "לא" : "כן",
        shareAmount: item.shareAmount,
        cashAmount: item.cashAmount,
        outcomeLabel: item.requestedOutcomeLabel || item.outcomeLabel,
      });
    }

    return normalizeHistoryItem({
      eventId: item.id,
      kind: "settlement",
      occurredAt: item.happenedAt,
      marketKey: item.marketKey,
      marketTitle: item.marketTitle,
      realizationType: item.realizationType,
      proceeds: item.proceeds,
      outcomeLabel: item.outcomeLabel,
    });
  }

  function normalizeBackendClaim(claim) {
    return {
      claimId: claim.claimId,
      marketKey: claim.marketKey,
      marketTitle: claim.marketTitle,
      outcomeLabel: claim.outcomeLabel,
      toWin: f.toNumber(claim.proceeds),
      toWinLabel: f.formatCurrency(claim.proceeds),
      status: claim.status,
    };
  }

  function buildChangeViewFromBackend(performance, positions) {
    if (!performance?.views) {
      return buildChangeViewFromFixture({}, positions);
    }

    // Frontend owns the chip set so the strip stays parity with our
    // reference (Polymarket's 1D/1W/1M/1Y/YTD/ALL) regardless of
    // whether the backend has shipped a given range yet. Ranges the
    // backend doesn't supply views for fall through to the
    // "אין נתונים לטווח הזה" empty state on selection — better UX
    // than silently hiding future-chips. If the backend exposes a
    // CUSTOM timeframe id we don't know about (rare), we accept it
    // by union with our canonical list.
    const FRONTEND_TIMEFRAMES = [
      { id: "day", label: "יום" },
      { id: "week", label: "שבוע" },
      { id: "month", label: "חודש" },
      { id: "year", label: "שנה" },
      { id: "ytd", label: "YTD" },
      { id: "all", label: "הכל" },
    ];
    const backendList = Array.isArray(performance.timeframes) ? performance.timeframes : [];
    const knownIds = new Set(FRONTEND_TIMEFRAMES.map((t) => t.id));
    const extraFromBackend = backendList.filter((t) => t && t.id && !knownIds.has(t.id));
    const timeframes = [...FRONTEND_TIMEFRAMES, ...extraFromBackend].map((timeframe) => ({
      id: timeframe.id,
      label: timeframe.label,
    }));
    const activeTimeframeId = performance.activeTimeframe || "all";
    const viewsByTimeframe = {};

    timeframes.forEach((timeframe) => {
      const view = performance.views?.[timeframe.id];
      if (!view) {
        viewsByTimeframe[timeframe.id] = null;
        return;
      }

      // Read the uniform typed movement block shipped 2026-05-28
      // (see systems/back/src/engine/portfolio/portfolio-read-service.ts).
      // Falls back to view.value + legacy dayMovement for safety if backend
      // somehow predates the typed block.
      const movement = view.movement || null;
      const amount = movement
        ? f.toNumber(movement.changeAbs)
        : f.toNumber(view.value);
      const pct = movement ? f.toNumber(movement.changePct) : null;
      const totalNow = movement ? f.toNumber(movement.totalNow) : null;
      const seriesPoints = view.series?.points || [];
      const firstSeriesValue = f.toNumber(seriesPoints[0]?.value);
      const chartPoints = seriesPoints
        .map((point) => {
          const value = f.toNumber(point.value);
          return {
            t: new Date(point.at).getTime(),
            value,
            displayValue: Number.isFinite(firstSeriesValue) ? value - firstSeriesValue : value,
          };
        })
        .filter((point) =>
          Number.isFinite(point.t) &&
          Number.isFinite(point.value)
        );

      // Backend emits carried numeric P&L points across the full
      // selected window. No null gaps; no visual time compression.
      const chartHasData = chartPoints.length >= 2;

      viewsByTimeframe[timeframe.id] = {
        totalMovementLabel: f.formatSignedCurrency(amount),
        totalMovementTone: classifyTone(amount),
        subEyebrowLabel: TIMEFRAME_SUB_EYEBROW[timeframe.id] || timeframe.label,
        pctLabel: pct !== null ? f.formatPercent(pct) : null,
        contextLabel:
          totalNow !== null && totalNow > 0 ? `מתוך ${f.formatCurrency(totalNow)}` : null,
        miniStatsLabel: null,
        isZero: amount === 0,
        chartHasData,
        // Raw series points for HzPnlSparklineRenderer. The renderer
        // owns coordinate projection, autoscale, and hover. View-model
        // just emits the time-ordered values.
        chartPoints: chartHasData
          ? chartPoints
          : [],
      };
    });

    return {
      timeframes,
      activeTimeframeId,
      viewsByTimeframe,
    };
  }

  function buildFromBackend(payload) {
    const snapshot = payload?.snapshot || {};
    const rowSource =
      snapshot.contractPositions?.length > 0
        ? snapshot.contractPositions
        : snapshot.positions || [];
    const positions = rowSource.map(normalizeBackendPosition);
    const claims = (payload?.claims?.claims || [])
      .filter((claim) => claim.status === "pending")
      .map(normalizeBackendClaim)
      .sort((a, b) => (b.toWin || 0) - (a.toWin || 0));

    return {
      mode: "backend",
      asOfLabel: snapshot.asOf ? `מעודכן ${f.formatHebrewDateTime(snapshot.asOf)}` : null,
      summary: {
        totalValue: f.formatCurrency(snapshot.summary?.totalAccountValue),
        availableValue: f.formatCurrency(snapshot.summary?.availableCash),
        // positions-only value (backend: portfolioValue = totalAccountValue − availableCash)
        positionsValue: f.formatCurrency(snapshot.summary?.portfolioValue),
      },
      change: buildChangeViewFromBackend(payload?.performance, positions),
      claims,
      positions,
      history: (payload?.history?.items || []).map(normalizeBackendHistoryItem),
    };
  }

  function sortByDayMovement(positions) {
    return [...positions].sort(
      (a, b) => Math.abs(b.dayPnl) - Math.abs(a.dayPnl)
    );
  }

  function topMovers(positions, n = 3) {
    return sortByDayMovement(positions).slice(0, n);
  }

  function claimablePositions(positions) {
    // Resolved-won positions waiting for the user to claim their payout.
    // Each contract pays V₪ 1 on a winning resolution, so the claim amount
    // equals the `toWin` value already computed on the normalized position.
    return positions
      .filter((p) => p.marketStatus === "resolved_win")
      .sort((a, b) => (b.toWin || 0) - (a.toWin || 0));
  }

  // Activity-table sort. Mirrors the sort vocabulary used by the
  // positions table: pick a column ("time" | "amount" | "type"),
  // pick a direction ("asc" | "desc"). null direction means use
  // the column's default (time→desc=newest first; amount→desc=largest
  // first; type→asc=alphabetical Hebrew). Stable enough for the
  // small history list; if scale grows, swap to a stable tagged sort.
  function sortHistory(history, sortBy = "time", sortDir = null) {
    const dir = sortDir ?? "desc";
    const items = [...history];
    if (sortBy === "amount") {
      items.sort((a, b) =>
        dir === "asc"
          ? (a.cashAmount || 0) - (b.cashAmount || 0)
          : (b.cashAmount || 0) - (a.cashAmount || 0)
      );
    } else if (sortBy === "type") {
      items.sort((a, b) => {
        const cmp = String(a.typeChipLabel || "").localeCompare(
          String(b.typeChipLabel || ""),
          "he"
        );
        return dir === "asc" ? cmp : -cmp;
      });
    } else {
      // default: time (newest first when desc)
      items.sort((a, b) => {
        const ta = new Date(a.occurredAt).getTime();
        const tb = new Date(b.occurredAt).getTime();
        return dir === "asc" ? ta - tb : tb - ta;
      });
    }
    return items;
  }

  function closingSoonPositions(positions, now = new Date(), n = 3) {
    return positions
      .map((p) => ({ position: p, timing: classifyClosingTime(p.marketCloseAt, now) }))
      .filter((entry) => entry.timing !== null)
      .sort(
        (a, b) =>
          new Date(a.timing.closeAt).getTime() -
          new Date(b.timing.closeAt).getTime()
      )
      .slice(0, n)
      .map((entry) => ({ ...entry.position, timing: entry.timing }));
  }

  window.NaviPortfolioViewModel = {
    classifyClosingTime,
    normalizePosition,
    buildChangeViewFromFixture,
    buildFromBackend,
    sortByDayMovement,
    topMovers,
    closingSoonPositions,
    claimablePositions,
    buildHistoryDescription,
    normalizeHistoryItem,
    sortHistory,
  };
})();
