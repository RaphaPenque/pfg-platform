import sharp from "sharp";
import path from "path";
import { PDFDocument } from "pdf-lib";

/**
 * Converts an image file (JPEG, PNG, WEBP, HEIC etc) to a PDF file.
 * The image is embedded in an A4 page with margins, maintaining aspect ratio.
 * Returns the path to the generated PDF.
 */
export async function imageToPdf(imagePath: string): Promise<string> {
  const pdfPath = imagePath.replace(/\.[^.]+$/, ".pdf");

  // Process image with sharp: auto-rotate from EXIF, convert to JPEG
  const jpegBuffer = await sharp(imagePath)
    .rotate() // auto-rotate from EXIF metadata
    .flatten({ background: { r: 255, g: 255, b: 255 } }) // flatten transparency
    .jpeg({ quality: 92 })
    .toBuffer();

  // Get dimensions
  const meta = await sharp(jpegBuffer).metadata();
  const imgW = meta.width ?? 800;
  const imgH = meta.height ?? 1100;

  // Create PDF with A4 page (595 x 842 points)
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);

  // Embed the JPEG
  const img = await pdfDoc.embedJpg(jpegBuffer);

  // Scale to fit within A4 with 20pt margins
  const maxW = 555; // 595 - 40
  const maxH = 802; // 842 - 40
  const scale = Math.min(maxW / imgW, maxH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const x = (595 - drawW) / 2;
  const y = (842 - drawH) / 2;

  page.drawImage(img, { x, y, width: drawW, height: drawH });

  const pdfBytes = await pdfDoc.save();
  const { writeFileSync } = await import("fs");
  writeFileSync(pdfPath, pdfBytes);

  return pdfPath;
}

/** Returns true if the mimetype or filename indicates an image */
export function isImageFile(mimeType?: string, filename?: string): boolean {
  if (mimeType && mimeType.startsWith("image/")) return true;
  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tiff", ".bmp"].includes(ext);
  }
  return false;
}

/**
 * Checks the actual file bytes to detect if a file is an image even if named .pdf
 * Returns true if the file magic bytes indicate JPEG, PNG, WEBP, GIF, BMP, TIFF
 */
export async function isImageByContent(filePath: string): Promise<boolean> {
  try {
    const fs = await import("fs");
    const buf = fs.readFileSync(filePath);
    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
    // PNG: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
    // WEBP: 52 49 46 46 ... 57 45 42 50
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true;
    // BMP: 42 4D
    if (buf[0] === 0x42 && buf[1] === 0x4D) return true;
    // TIFF: 49 49 or 4D 4D
    if ((buf[0] === 0x49 && buf[1] === 0x49) || (buf[0] === 0x4D && buf[1] === 0x4D)) return true;
    return false;
  } catch {
    return false;
  }
}
