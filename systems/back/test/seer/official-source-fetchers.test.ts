import { describe, expect, it } from "vitest";

import {
  parseHomeFrontNewsResponse,
  parseIaaNotificationsHtml,
  toHomeFrontManualSignals,
  toIaaManualSignals
} from "../../../seer/src/official-source-fetchers";

const homeFrontFixture = JSON.stringify({
  content: [
    {
      id: 16223,
      time: "2026-04-08T06:00:00Z",
      title: "Update - Home Front Command Defensive Policy",
      text: '<p><strong>Policy remains unchanged.</strong></p><p><a href="https://www.oref.org.il/eng/articles/info/iron-swords/1100/">All guidelines</a></p>'
    }
  ]
});

const iaaFixture = `
<section class="box-wrapper shadow bg-white" id="noteid-26085">
  <header class="box--headering mb-4">
    <h2 class="text-26 fnt-bold" id="post_title-4">Closure of the Airspace of the State of Israel to Civil Aviation</h2>
    <time datetime="2026-02-28T15:32" id="post_date-4">2/28/2026 3:32 PM</time>
  </header>
  <div class="box--content d-inline-block">
    <p>For the information of the general public,</p>
    <p>The public is requested not to arrive at airports until further notice.</p>
  </div>
  <footer class="box--footer mt-5">
    <div class="addthis_inline_share_toolbox" data-url="https://www.iaa.gov.il/en/airports/ben-gurion/notifications-and-updates/#noteid-26085" data-title="Closure of the Airspace of the State of Israel to Civil Aviation"></div>
  </footer>
</section>
`;

describe("official source fetchers", () => {
  it("parses Home Front Command news json into manual signals", () => {
    const items = parseHomeFrontNewsResponse(homeFrontFixture);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 16223,
      title: "Update - Home Front Command Defensive Policy"
    });

    const signals = toHomeFrontManualSignals(items, "2026-04-08T10:00:00.000Z");
    expect(signals[0]).toMatchObject({
      sourceId: "src_home_front_command",
      category: "security",
      sourceRef: "https://www.oref.org.il/eng/articles/info/iron-swords/1100/"
    });
    expect(signals[0]?.tags).toContain("home-front-command");
  });

  it("parses IAA notifications html into manual signals", () => {
    const items = parseIaaNotificationsHtml(iaaFixture);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "26085",
      publishedAt: "2026-02-28T15:32:00"
    });

    const signals = toIaaManualSignals(items, "2026-04-08T10:00:00.000Z");
    expect(signals[0]).toMatchObject({
      sourceId: "src_iaa_notifications",
      category: "travel",
      sourceRef: "https://www.iaa.gov.il/en/airports/ben-gurion/notifications-and-updates/#noteid-26085"
    });
    expect(signals[0]?.clusterHint).toContain("closure_of_the_airspace");
  });
});
