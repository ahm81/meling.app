import * as mupdf from "mupdf";

export class PdfReadError extends Error {
  constructor(cause?: unknown) {
    super("Filen kunne ikke leses som PDF.", { cause });
    this.name = "PdfReadError";
  }
}

/**
 * Renders each page of a PDF to a PNG, one page at a time so only one bitmap is in memory.
 * `scale` is pixels per PDF point (2 gives about 144 dpi).
 */
export async function* renderPdf(
  pdf: Buffer,
  scale = 2,
): AsyncGenerator<{ page: number; png: Buffer; width: number; height: number }> {
  let doc: mupdf.Document;
  let count: number;
  try {
    doc = mupdf.Document.openDocument(pdf, "application/pdf");
    count = doc.countPages();
  } catch (e) {
    throw new PdfReadError(e);
  }
  try {
    if (count < 1) throw new PdfReadError();
    for (let i = 0; i < count; i++) {
      let rendered: { png: Buffer; width: number; height: number };
      let page: mupdf.Page | undefined;
      let pixmap: mupdf.Pixmap | undefined;
      try {
        page = doc.loadPage(i);
        pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
        rendered = { png: Buffer.from(pixmap.asPNG()), width: pixmap.getWidth(), height: pixmap.getHeight() };
      } catch (e) {
        throw e instanceof PdfReadError ? e : new PdfReadError(e);
      } finally {
        // mupdf objects live in WASM memory and are not garbage collected.
        pixmap?.destroy();
        page?.destroy();
      }
      yield { page: i + 1, ...rendered };
    }
  } finally {
    doc.destroy();
  }
}
