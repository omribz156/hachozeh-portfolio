const MARK_TEXT = 'V₪';
const MARK_RE = /V[\u200e\u200f]?\u20aa/g;

const numberFormat = new Intl.NumberFormat('he-IL', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

function renderVShekelSymbolHtml({ decorative = false } = {}) {
  const symbol = '<span class="hz-vshekel-symbol" aria-hidden="true"><span class="hz-vshekel-fallback">V₪</span></span>';
  if (decorative) return symbol;
  return '<span class="hz-vshekel-inline" dir="ltr" role="img" aria-label="V₪">' + symbol + '</span>';
}

function formatClientVShekelAmount(value, { signed = false } = {}) {
  const raw = String(value ?? '').trim();
  const hasExplicitPositive = raw.startsWith('+');
  const numeric = Number(raw.replace(/,/g, '')) || 0;
  const sign = signed && (hasExplicitPositive || numeric > 0) ? '+' : numeric < 0 ? '-' : '';
  return sign + numberFormat.format(Math.abs(numeric));
}

function moneyText(value, options = {}) {
  return `\u2066${MARK_TEXT} ${formatClientVShekelAmount(value, options)}\u2069`;
}

function renderVShekelMoneyHtml(value, options = {}) {
  const amount = formatClientVShekelAmount(value, options);
  return `<bdi class="hz-money" dir="ltr" aria-label="${MARK_TEXT} ${amount}">${renderVShekelSymbolHtml({ decorative: true })}<span>${amount}</span></bdi>`;
}

function isSkippable(node) {
  const el = node?.parentElement;
  if (!el) return true;
  if (el.closest('.hz-vshekel-symbol, .hz-vshekel-fallback, .hz-money')) return true;
  if (el.closest('script, style, textarea, input, select, option, svg, canvas')) return true;
  return false;
}

function symbolNode(documentRef) {
  const wrapper = documentRef.createElement('span');
  wrapper.innerHTML = renderVShekelSymbolHtml();
  return wrapper;
}

function moneyNode(documentRef, amount) {
  const wrapper = documentRef.createElement('bdi');
  wrapper.className = 'hz-money';
  wrapper.setAttribute('dir', 'ltr');
  wrapper.setAttribute('aria-label', `${MARK_TEXT} ${amount}`);
  wrapper.innerHTML = `${renderVShekelSymbolHtml({ decorative: true })}<span>${amount}</span>`;
  return wrapper;
}

function replaceTextNode(node) {
  let value = node.nodeValue || '';
  value = value
    .replace(/([+\-−]?\s?[\d.,]+(?:[KkMm])?)\s*V[\u200e\u200f]?\u20aa/g, (_, amount) => `${MARK_TEXT} ${String(amount).trim()}`)
    .replace(/V[\u200e\u200f]?\u20aa\s*([+\-−]?\s?[\d.,]+(?:[KkMm])?)/g, (_, amount) => `${MARK_TEXT} ${String(amount).trim()}`);
  if (!MARK_RE.test(value) || isSkippable(node)) {
    MARK_RE.lastIndex = 0;
    return;
  }
  MARK_RE.lastIndex = 0;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;
  while ((match = MARK_RE.exec(value))) {
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
    }
    const after = value.slice(match.index + match[0].length);
    const amount = after.match(/^(\s*[+\-−]?\s?[\d.,]+(?:[KkMm])?)/);
    if (amount) {
      fragment.appendChild(moneyNode(document, amount[1].trim()));
      lastIndex = match.index + match[0].length + amount[0].length;
    } else {
      fragment.appendChild(symbolNode(document));
      lastIndex = match.index + match[0].length;
    }
  }
  if (lastIndex < value.length) {
    fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
  }
  node.parentNode?.replaceChild(fragment, node);
}

function upgrade(root = document.body) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    replaceTextNode(root);
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(replaceTextNode);
}

window.HZCurrency = {
  moneyHtml: renderVShekelMoneyHtml,
  moneyText,
  symbolHtml: renderVShekelSymbolHtml,
  upgrade,
};

function bootVShekelCurrency() {
  upgrade();
  if (window.__hzVshekelObserver) return;
  window.__hzVshekelObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        replaceTextNode(mutation.target);
      } else {
        mutation.addedNodes.forEach((node) => upgrade(node));
      }
    }
  });
  window.__hzVshekelObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootVShekelCurrency, { once: true });
} else {
  bootVShekelCurrency();
}
document.addEventListener('astro:page-load', () => upgrade());
