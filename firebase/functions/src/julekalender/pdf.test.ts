import { describe, expect, it } from "vitest";
import { renderPdf } from "./pdf";
import { minimalPdf } from "./testing/minimal-pdf";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("renderPdf", () => {
  it("renders every page as a PNG at the given scale", async () => {
    const pages = [];
    for await (const p of renderPdf(minimalPdf(3), 2)) pages.push(p);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    for (const p of pages) {
      expect(p.png.subarray(0, 4)).toEqual(PNG_MAGIC);
      expect(p.width).toBe(596);
      expect(p.height).toBe(840);
    }
  });

  it("throws a Norwegian error for a file that is not a PDF", async () => {
    const consume = async () => {
      for await (const _ of renderPdf(Buffer.from("ikke en pdf"))) void _;
    };
    await expect(consume()).rejects.toThrow("Filen kunne ikke leses som PDF.");
  });
});
