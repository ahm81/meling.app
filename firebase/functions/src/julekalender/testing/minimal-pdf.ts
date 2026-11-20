/** Builds a valid PDF with `pages` blank A6 pages, for tests. */
export function minimalPdf(pages: number): Buffer {
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 298 420] >>"),
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export interface PdfBrick {
  /** Left edge and top edge of the picture in points from the page's top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fill colour of the picture, 0–255 per channel. */
  rgb: [number, number, number];
  /** Count printed right below the picture ("2x"). */
  qty: number;
  /** Element id printed below the count, as in a parts list. */
  elementId?: string;
  /** Font size of the count (default 7, as in a parts box). */
  fontSize?: number;
}

/**
 * Builds a PDF shaped like a LEGO manual, for tests: each brick is its own picture (a plain colour) with
 * the count as text below it and, for parts lists, the element id below the count. Pages are 400 × 300 points.
 */
export function brickPdf(pages: PdfBrick[][]): Buffer {
  const W = 400;
  const H = 300;
  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
  const stream = (dict: string, data: Buffer) =>
    Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);

  // Object numbers: 1 catalog, 2 pages, 3 font, then per page: page, content, and one image per brick.
  const pageIds: number[] = [];
  let next = 4;
  const layout = pages.map((bricks) => {
    const page = next++;
    const content = next++;
    const images = bricks.map(() => next++);
    pageIds.push(page);
    return { page, content, images, bricks };
  });
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const { content, images, bricks } of layout) {
    const xobjects = images.map((id, i) => `/Im${i} ${id} 0 R`).join(" ");
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${content} 0 R /Resources << /Font << /F1 3 0 R >> /XObject << ${xobjects} >> >> >>`);
    const ops = bricks.map((b, i) => {
      const bottom = H - b.y - b.h;
      const size = b.fontSize ?? 7;
      const text = (s: string, baseline: number, fontSize: number) => `BT /F1 ${fontSize} Tf ${b.x} ${baseline} Td (${s}) Tj ET`;
      return [
        `q ${b.w} 0 0 ${b.h} ${b.x} ${bottom} cm /Im${i} Do Q`,
        text(`${b.qty}x`, bottom - size - 1, size),
        b.elementId ? text(b.elementId, bottom - size - 9, 7) : "",
      ].join("\n");
    });
    add(stream("", Buffer.from(ops.join("\n"), "latin1")));
    for (const b of bricks) {
      add(stream("/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8", Buffer.from(Array.from({ length: 16 }, () => b.rgb).flat())));
    }
  }

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    chunks.push(chunk);
    length += chunk.length;
  });
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) tail += `${String(o).padStart(10, "0")} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  return Buffer.concat([...chunks, Buffer.from(tail, "latin1")]);
}

const RED: [number, number, number] = [200, 30, 30];
const BLUE: [number, number, number] = [30, 60, 200];
const GREEN: [number, number, number] = [40, 160, 60];
const YELLOW: [number, number, number] = [240, 200, 40];
const BLACK: [number, number, number] = [20, 20, 20];

/**
 * A two-page manual: page 1 has a parts box (2 red, 1 blue, drawn 1.3 times larger than the parts list) and
 * a big "2x"; page 2 is a parts list with five bricks, of which the set has 4 red and 2 blue.
 */
export const sampleBrickPdf = (): Buffer =>
  brickPdf([
    [
      { x: 40, y: 30, w: 26, h: 19.5, rgb: RED, qty: 2 },
      { x: 90, y: 30, w: 26, h: 26, rgb: BLUE, qty: 1 },
      { x: 250, y: 150, w: 100, h: 60, rgb: GREEN, qty: 2, fontSize: 40 },
    ],
    [
      { x: 20, y: 20, w: 20, h: 15, rgb: RED, qty: 4, elementId: "300021" },
      { x: 20, y: 80, w: 20, h: 20, rgb: BLUE, qty: 2, elementId: "300023" },
      { x: 20, y: 140, w: 30, h: 12, rgb: GREEN, qty: 1, elementId: "300028" },
      { x: 120, y: 20, w: 12, h: 30, rgb: YELLOW, qty: 1, elementId: "300024" },
      { x: 120, y: 80, w: 40, h: 40, rgb: BLACK, qty: 1, elementId: "300026" },
    ],
  ]);
