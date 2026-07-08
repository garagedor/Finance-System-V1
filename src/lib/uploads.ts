// Receipt / attachment storage.
//
// Local dev: writes to /public/uploads/<random>-<sanitised-name>. Next.js
// serves that directory as static assets so the public URL is
// /uploads/<filename> — no extra route needed.
//
// Production: swap this module to upload to S3 / Cloudflare R2 / Vercel
// Blob and return the resulting public URL. The rest of the app only sees
// the URL string and doesn't care where it lives.

import "server-only";
import { randomBytes } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per file
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

export interface SavedFile {
  url: string;
  filename: string;
  content_type: string;
  bytes: number;
}

export async function saveUpload(args: {
  buffer: Buffer;
  filename: string;
  content_type: string;
}): Promise<SavedFile> {
  if (args.buffer.length === 0) throw new Error("File is empty");
  if (args.buffer.length > MAX_BYTES) {
    throw new Error(`File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)`);
  }
  if (!ALLOWED_TYPES.has(args.content_type)) {
    throw new Error(`Unsupported file type: ${args.content_type}`);
  }
  await mkdir(UPLOADS_DIR, { recursive: true });
  const ext = sanitisedExt(args.filename, args.content_type);
  const safeBase = args.filename
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 60)
    .replace(/\.+$/, "");
  const filename = `${randomBytes(8).toString("hex")}-${safeBase}${ext && !safeBase.endsWith(ext) ? "" : ""}`;
  // Ensure extension is present
  const finalName = filename.endsWith(ext) || ext === "" ? filename : `${filename}${ext}`;
  await writeFile(path.join(UPLOADS_DIR, finalName), args.buffer);
  return {
    url: `/uploads/${finalName}`,
    filename: args.filename,
    content_type: args.content_type,
    bytes: args.buffer.length,
  };
}

export async function deleteUpload(url: string): Promise<void> {
  if (!url.startsWith("/uploads/")) return;
  const filename = url.slice("/uploads/".length);
  if (filename.includes("/") || filename.includes("..")) return; // safety
  try {
    await unlink(path.join(UPLOADS_DIR, filename));
  } catch {
    /* file may already be gone */
  }
}

function sanitisedExt(filename: string, contentType: string): string {
  const m = filename.match(/\.[A-Za-z0-9]{1,5}$/);
  if (m) return m[0].toLowerCase();
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "application/pdf") return ".pdf";
  return "";
}
