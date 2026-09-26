const nf0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('he-IL', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const classNames = (...items) => items.filter(Boolean).join(' ');
const MONEY_MARK_RE = /V[\u200e\u200f]?\u20aa/g;
const AMOUNT_THEN_MARK_RE = /([+\-−]?\s?[\d.,]+(?:[KkMm])?)\s*V[\u200e\u200f]?\u20aa/g;
const MARK_THEN_AMOUNT_RE = /V[\u200e\u200f]?\u20aa\s*([+\-−]?\s?[\d.,]+(?:[KkMm])?)/g;

export function VShekelSymbol({ className = '', decorative = false } = {}) {
  if (decorative) {
    return (
      <span class={classNames('hz-vshekel-symbol', className)} aria-hidden="true">
        <span class="hz-vshekel-fallback">V₪</span>
      </span>
    );
  }

  return (
    <span class={classNames('hz-vshekel-inline', className)} dir="ltr" role="img" aria-label="V₪">
      <span class="hz-vshekel-symbol" aria-hidden="true">
        <span class="hz-vshekel-fallback">V₪</span>
      </span>
    </span>
  );
}

export function VShekelAmount({
  value,
  signed = false,
  maximumFractionDigits = 2,
  className = '',
} = {}) {
  const numeric = Number(value) || 0;
  const sign = signed && numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  const amount = Math.abs(numeric).toLocaleString('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
  const label = `V₪ ${sign}${amount}`;
  return (
    <bdi class={classNames('hz-money', className)} dir="ltr" aria-label={label}>
      <VShekelSymbol decorative />
      <span>{sign}{amount}</span>
    </bdi>
  );
}

export function VShekelPrice({ value, className = '' } = {}) {
  const amount = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return <VShekelAmount value={amount} maximumFractionDigits={0} className={className} />;
}

export function VShekelProbabilityPrice({ value, className = '' } = {}) {
  return <VShekelPrice value={(Number(value) || 0) * 100} className={className} />;
}

export function VShekelText({ text, className = '' } = {}) {
  const raw = String(text ?? '').replace(/[\u2066\u2069]/g, '');
  const normalized = raw
    .replace(AMOUNT_THEN_MARK_RE, (_, amount) => `V₪ ${String(amount).trim()}`)
    .replace(MARK_THEN_AMOUNT_RE, (_, amount) => `V₪ ${String(amount).trim()}`);
  const parts = normalized.split(MONEY_MARK_RE);
  if (parts.length === 1) return raw;
  return (
    <span class={className}>
      {parts.map((part, index) => {
        if (index === 0) return part;
        const match = part.match(/^(\s*[+\-−]?\s?[\d.,]+(?:[KkMm])?)(.*)$/);
        if (!match) {
          return (
            <>
              <VShekelSymbol />
              {part}
            </>
          );
        }
        const amount = match[1].trim();
        return (
          <>
            <bdi class="hz-money" dir="ltr" aria-label={`V₪ ${amount}`}>
              <VShekelSymbol decorative />
              <span>{amount}</span>
            </bdi>
            {match[2]}
          </>
        );
      })}
    </span>
  );
}

export const formatVShekelAmount = (value, { signed = false, maximumFractionDigits = 2 } = {}) => {
  const numeric = Number(value) || 0;
  const sign = signed && numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  const format = maximumFractionDigits === 0 ? nf0 : nf2;
  return `${sign}${format.format(Math.abs(numeric))}`;
};
