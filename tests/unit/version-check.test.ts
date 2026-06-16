import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseGnafReleasePage } from "../../src/lib/version-check";

const GNAF_PAGE_HTML = readFileSync(
  "tests/fixtures/data-gov-au-page.html",
  "utf-8",
);

describe("parseGnafReleasePage", () => {
  test("extracts GDA2020 release from mock page", () => {
    const result = parseGnafReleasePage(GNAF_PAGE_HTML);
    expect(result).not.toBeNull();
    expect(result!.version).toBe("MAY 2026");
    expect(result!.downloadUrl).toContain("g-naf_may26_allstates_gda2020_psv_1023.zip");
  });

  test("extracts the GDA2020 entry (not GDA94)", () => {
    const result = parseGnafReleasePage(GNAF_PAGE_HTML);
    expect(result!.version).toBe("MAY 2026");
    // Must pick GDA2020, not GDA94
    expect(result!.downloadUrl).toContain("gda2020");
    expect(result!.downloadUrl).not.toContain("gda94");
  });

  test("returns null when no GDA2020 entry exists", () => {
    const html = `<html><body>
      <ul class="resource-list">
        <li class="resource-item">
          <a class="resource-name">MAY 2026 - Geoscape G-NAF - GDA94</a>
          <a class="dropdown-item resource-url-analytics" href="https://example.com/gda94.zip">Download</a>
        </li>
      </ul>
    </body></html>`;
    expect(parseGnafReleasePage(html)).toBeNull();
  });

  test("returns null when resource list is empty", () => {
    const html = `<html><body><ul class="resource-list"></ul></body></html>`;
    expect(parseGnafReleasePage(html)).toBeNull();
  });

  test("returns null for completely unrelated HTML", () => {
    const html = `<html><body><h1>Hello World</h1></body></html>`;
    expect(parseGnafReleasePage(html)).toBeNull();
  });

  test("handles case-insensitive G-NAF - GDA2020 matching", () => {
    const html = `<html><body>
      <ul class="resource-list">
        <li class="resource-item">
          <a class="resource-name">aug 2026 - geoscape g-naf - gda2020</a>
          <a class="dropdown-item resource-url-analytics" href="https://example.com/g-naf_aug2026.zip">Download</a>
        </li>
      </ul>
    </body></html>`;
    const result = parseGnafReleasePage(html);
    expect(result).not.toBeNull();
    expect(result!.version).toBe("AUG 2026");
  });

  test("extracts version with different month names", () => {
    const months = ["FEB", "MAY", "AUG", "NOV"];
    for (const month of months) {
      const html = `<html><body>
        <ul class="resource-list">
          <li class="resource-item">
            <a class="resource-name">${month} 2026 - Geoscape G-NAF - GDA2020</a>
            <a class="dropdown-item resource-url-analytics" href="https://example.com/gnaf.zip">Download</a>
          </li>
        </ul>
      </body></html>`;
      const result = parseGnafReleasePage(html);
      expect(result!.version).toBe(`${month} 2026`);
    }
  });
});
