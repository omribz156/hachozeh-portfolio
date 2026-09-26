const VSHEKEL_TEXT = 'V₪';
const VSHEKEL_SYMBOL_HTML =
  '<span class="hz-vshekel-symbol" aria-hidden="true"><span class="hz-vshekel-fallback">V₪</span></span>';
const VSHEKEL_SYMBOL_ACCESSIBLE_HTML =
  '<span class="hz-vshekel-inline" dir="ltr" role="img" aria-label="V₪">' +
  VSHEKEL_SYMBOL_HTML +
  '</span>';

const money = new Intl.NumberFormat('he-IL', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

type VShekelFormatOptions = {
  signed?: boolean;
};

function formatVShekelHtmlAmount(value: unknown, { signed = false }: VShekelFormatOptions = {}): string {
  const raw = String(value ?? '').trim();
  const hasExplicitPositive = raw.startsWith('+');
  const numeric = Number(raw.replace(/,/g, '')) || 0;
  const sign = signed && (hasExplicitPositive || numeric > 0) ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${money.format(Math.abs(numeric))}`;
}

export function vshekelMoneyText(value: unknown, options: VShekelFormatOptions = {}): string {
  return `\u2066${VSHEKEL_TEXT} ${formatVShekelHtmlAmount(value, options)}\u2069`;
}

export function vshekelMoneyHtml(value: unknown, options: VShekelFormatOptions = {}): string {
  const amount = formatVShekelHtmlAmount(value, options);
  return `<bdi class="hz-money" dir="ltr" aria-label="${VSHEKEL_TEXT} ${amount}">${VSHEKEL_SYMBOL_HTML}<span>${amount}</span></bdi>`;
}

export function vshekelSymbolHtml({ decorative = false } = {}): string {
  return decorative ? VSHEKEL_SYMBOL_HTML : VSHEKEL_SYMBOL_ACCESSIBLE_HTML;
}
