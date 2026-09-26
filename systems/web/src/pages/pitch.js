// Serves the Hachozeh product-overview deck at /pitch (extensionless).
//
// The deck is a single self-contained HTML document — inlined Hebrew fonts,
// brand glyph, styles and script, no backend calls. We import it raw and hand
// it back verbatim so the URL stays clean. To change a slide, edit
// src/pitch-deck/deck.html and rebuild (it's the source of truth).
import deckHtml from '../pitch-deck/deck.html?raw';

export function GET() {
  return new Response(deckHtml, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Cheap to serve and rarely changes: let the CDN hold it for an hour,
      // browsers for five minutes.
      'cache-control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
