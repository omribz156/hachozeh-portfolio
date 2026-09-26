import { describe, expect, it } from "vitest";

import {
  publicizeResolutionSourceText,
  readPublicResolutionSourceUrl,
  stripResolutionSourceUrl,
  toPublicResolutionSourceUrl
} from "../../src/shared/public-source";

describe("public resolution source helpers", () => {
  it("maps Winner League machine JSON anchors to the public game page", () => {
    expect(
      toPublicResolutionSourceUrl("https://basket.co.il/pbp/json/games_all.json#game-26515")
    ).toBe("https://basket.co.il/game-zone.asp?GameId=26515#!stats");
    expect(
      toPublicResolutionSourceUrl("https://basket.co.il/pbp/json/games_all.json#game=26515")
    ).toBe("https://basket.co.il/game-zone.asp?GameId=26515#!stats");
  });

  it("keeps non-machine source URLs intact", () => {
    expect(toPublicResolutionSourceUrl("https://www.nba.com/game/tor-vs-cle-0042500137")).toBe(
      "https://www.nba.com/game/tor-vs-cle-0042500137"
    );
  });

  it("drops non-HTTPS public source URLs", () => {
    expect(toPublicResolutionSourceUrl("javascript:alert(1)")).toBeNull();
    expect(toPublicResolutionSourceUrl("local://operator-clean-platform/fixture")).toBeNull();
    expect(toPublicResolutionSourceUrl("http://example.com/result")).toBeNull();
    expect(readPublicResolutionSourceUrl(null, "javascript:alert(1)")).toBeNull();
  });

  it("extracts a public URL and strips the URL from the display label", () => {
    const source =
      "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל: https://basket.co.il/pbp/json/games_all.json#game-26515";

    expect(readPublicResolutionSourceUrl(source)).toBe(
      "https://basket.co.il/game-zone.asp?GameId=26515#!stats"
    );
    expect(stripResolutionSourceUrl(source)).toBe("תוצאת המשחק הרשמית של מנהלת ליגת Winner סל");
  });

  it("rewrites machine URLs inside public rule text", () => {
    expect(
      publicizeResolutionSourceText(
        "מקור ההכרעה: https://basket.co.il/pbp/json/games_all.json#game-26515"
      )
    ).toBe("מקור ההכרעה: https://basket.co.il/game-zone.asp?GameId=26515#!stats");
  });

  it("drops unsafe URLs inside public rule text", () => {
    expect(
      publicizeResolutionSourceText(
        "מקור פנימי: http://internal.local/result. מקור ציבורי: https://www.nba.com/game/tor-vs-cle-0042500137"
      )
    ).toBe("מקור פנימי: מקור ציבורי: https://www.nba.com/game/tor-vs-cle-0042500137");
    expect(publicizeResolutionSourceText("http://internal.local/result")).toBeNull();
  });

  it("preserves intentional paragraph breaks in public rule text", () => {
    expect(publicizeResolutionSourceText("שורה ראשונה.  \n\n  שורה שנייה.")).toBe(
      "שורה ראשונה.\n\nשורה שנייה."
    );
  });
});
