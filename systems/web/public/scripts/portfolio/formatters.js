(function () {
  const currency = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const quantity = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const percent = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const hebrewLongDay = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const hebrewDateTime = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Number.parseFloat(String(value ?? "0"));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatCurrency(value) {
    return `\u2066V₪ ${currency.format(toNumber(value))}\u2069`;
  }

  function formatSignedCurrency(value) {
    const amount = toNumber(value);
    const absolute = `\u2066V₪ ${currency.format(Math.abs(amount))}\u2069`;
    if (amount > 0) return `\u2066V₪ +${currency.format(Math.abs(amount))}\u2069`;
    if (amount < 0) return `\u2066V₪ -${currency.format(Math.abs(amount))}\u2069`;
    return absolute;
  }

  function formatPercent(value) {
    const amount = toNumber(value);
    const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
    return `${sign}${percent.format(Math.abs(amount))}%`;
  }

  function formatQuantity(value) {
    return `${quantity.format(toNumber(value))} חוזים`;
  }

  function formatPriceTag(value) {
    return `\u2066V₪ ${currency.format(toNumber(value) * 100)}\u2069`;
  }

  function formatInteger(value) {
    return integer.format(toNumber(value));
  }

  function formatHebrewDay(value) {
    if (value == null) return "זמן לא זמין";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "זמן לא זמין";
    return hebrewLongDay.format(parsed);
  }

  function formatHebrewDateTime(value) {
    if (value == null) return "זמן לא זמין";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "זמן לא זמין";
    return hebrewDateTime.format(parsed);
  }

  // Chart-hover timestamp — "7 במרץ 2026, 02:00" shape. Long-form
  // Hebrew month with the ב prefix (grammatical for this date form),
  // year included, 24h time rounded to the nearest hour, comma
  // separator. Pattern matches Polymarket's portfolio chart tooltip
  // ("Mar 7, 2026 2:00 AM"), keeping our 24h convention.
  //
  // Built manually rather than via Intl's preset since `he-IL` with
  // `month: "long" + hour + minute` inserts "בשעה" ("at the hour") —
  // verbose for a chart tooltip. We pull only the date part from
  // Intl (which gives the ב-prefixed month correctly) and append our
  // own 24h "HH:00" with a comma.
  //
  // Display-side rounding (2026-05-30): sample timestamps come off
  // backend buckets that aren't always wall-clock aligned (we saw
  // :15 / :40 minute offsets in practice). The tooltip rounds to the
  // nearest hour on every range so the hovered string reads as a
  // deliberate beat ("14:00") instead of noise ("14:15"). The hour
  // is shown across the full chip set — 1D / 1W / 1M / 1Y / YTD /
  // ALL — because the sub-eyebrow is the "where am I in time"
  // anchor, and "27 במאי 2026" without time felt amputated at
  // wider zooms. The hour stays accurate to the underlying sample;
  // we just snap minutes to :00.
  const hebrewTooltipDate = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  function formatHebrewTooltipTimestamp(value) {
    if (value == null) return "זמן לא זמין";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "זמן לא זמין";
    const rounded = new Date(parsed.getTime());
    rounded.setMinutes(0, 0, 0);
    // Round to nearest hour rather than floor (so :40 → next hour,
    // :20 → previous hour). Matches what the eye expects when the
    // cursor is between two hour ticks.
    if (parsed.getMinutes() >= 30) {
      rounded.setHours(rounded.getHours() + 1);
    }
    const datePart = hebrewTooltipDate.format(rounded);
    const hh = rounded.getHours().toString().padStart(2, "0");
    return `${datePart}, ${hh}:00`;
  }

  // Hebrew relative-time labels for the Activity table — short and
  // forensic. Mirrors Polymarket's "3h ago / 8d ago / 1mo ago"
  // compactness but stays in Hebrew register.
  //   <1m   → "עכשיו"
  //   <60m  → "לפני N דק׳"
  //   <24h  → "לפני N שע׳"
  //   <30d  → "לפני N ימים"
  //   <12mo → "לפני N חוד׳"
  //   else  → "לפני N שנים"
  // Optional `now` param for deterministic tests; defaults to Date.now().
  function formatHebrewRelative(value, now) {
    if (value == null) return "זמן לא זמין";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "זמן לא זמין";
    const nowMs = typeof now === "number" ? now : Date.now();
    const diffSec = Math.max(0, Math.floor((nowMs - parsed.getTime()) / 1000));
    if (diffSec < 60) return "עכשיו";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `לפני ${diffMin} דק׳`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `לפני ${diffHr} שע׳`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `לפני ${diffDay} ימים`;
    const diffMo = Math.floor(diffDay / 30);
    if (diffMo < 12) return `לפני ${diffMo} חוד׳`;
    const diffYr = Math.floor(diffMo / 12);
    return `לפני ${diffYr} שנים`;
  }

  window.NaviPortfolioFormatters = {
    toNumber,
    formatCurrency,
    formatSignedCurrency,
    formatPercent,
    formatQuantity,
    formatPriceTag,
    formatInteger,
    formatHebrewDay,
    formatHebrewDateTime,
    formatHebrewTooltipTimestamp,
    formatHebrewRelative,
  };
})();
