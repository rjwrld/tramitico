import type { ImageMarkupNotice } from "./extract";

/** 127×124 seals are the largest harmless raster in the affected corpus PDF. */
const PDF_IMAGE_PIXEL_FLOOR = 20_000;

interface PdfImage {
  page: number;
  width: number;
  height: number;
  object: number;
  generation: number;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const identity = (image: PdfImage) =>
  `p${image.page}-obj${image.object}-${image.generation}`;

function listedImages(listing: string): PdfImage[] {
  const images: PdfImage[] = [];
  for (const line of listing.split("\n")) {
    // Match the rendered image only. Poppler lists a transparency mask/smask
    // immediately after its parent; treating that helper raster as another
    // candidate would double-report the same visual (as the CCSS fixture does).
    const match = line.match(
      /^\s*(\d+)\s+\d+\s+image\s+(\d+)\s+(\d+)\s+\S+\s+\d+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d+)\s+/,
    );
    if (!match) continue;
    const image = {
      page: Number(match[1]),
      width: Number(match[2]),
      height: Number(match[3]),
      object: Number(match[4]),
      generation: Number(match[5]),
    };
    if (image.width * image.height >= PDF_IMAGE_PIXEL_FLOOR) {
      images.push(image);
    }
  }
  return images;
}

interface PdfImageNoticeOptions {
  /** The 1-based inclusive page range whose text is actually ingested. */
  pages?: string;
  /** Page/object identities a human has already inspected (#177). */
  imagesAudited?: readonly string[];
}

function inPageRange(image: PdfImage, pages?: string): boolean {
  if (!pages) return true;
  const match = pages.match(/^(\d+)-(\d+)$/);
  if (!match)
    throw new Error(`source.pages must be "<first>-<last>", got "${pages}"`);
  return image.page >= Number(match[1]) && image.page <= Number(match[2]);
}

/**
 * The ingestion-time notice for raster images reported by `pdfimages -list`.
 *
 * Like the HTML image notice, this is advisory: an image may be harmless page
 * furniture, so extraction warns rather than rejecting the document.
 */
export function pdfImageNotice(
  docKey: string,
  listing: string,
  options: PdfImageNoticeOptions = {},
): ImageMarkupNotice | null {
  const images = listedImages(listing).filter((image) =>
    inPageRange(image, options.pages),
  );
  if (images.length === 0) return null;
  const imageCount = plural(images.length, "substantial-size PDF image");
  const auditedImages = options.imagesAudited;
  if (
    auditedImages &&
    images.every((image) => auditedImages.includes(identity(image)))
  ) {
    return {
      level: "info",
      message: `${docKey}: ${imageCount}, audited (#196)`,
    };
  }
  const warning = [
    `${docKey}: PDF carries ${imageCount} in the ingested pages. pdftotext drops embedded rasters silently — check each image before trusting this document's figures (#196).`,
    ...images.map(
      (image) => `    ${identity(image)} (${image.width}×${image.height})`,
    ),
  ];
  if (auditedImages) {
    const audited = new Set(auditedImages);
    const drifted = images.filter((image) => !audited.has(identity(image)));
    warning.push(
      `  ${plural(drifted.length, "image")} not in the audited set — the PDF has drifted since its image audit and nobody has looked at these (#177):`,
      ...drifted.map((image) => `    ${identity(image)}`),
    );
  }
  return {
    level: "warn",
    message: warning.join("\n"),
  };
}
