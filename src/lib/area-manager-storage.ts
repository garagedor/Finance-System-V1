// Supabase Storage helper for Area Manager W9 files.
//
// Bucket is created on demand (idempotent). Uploads use the admin session
// the existing supabase-server client signs in as, so RLS / storage policies
// inherit from that user. If the admin user lacks storage perms on Lovable
// Cloud, the helper surfaces the raw error so the caller can fall back or
// the user can grant the policy on the Lovable side.

import { getSupabaseServerClient, isSupabaseConfigured } from './supabase-server';

const BUCKET = 'area-manager-w9s';

async function ensureBucket(): Promise<void> {
  const supa = await getSupabaseServerClient();
  const { data: buckets } = await supa.storage.listBuckets();
  if (buckets?.some((b) => b.name === BUCKET)) return;
  const { error } = await supa.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024, // 10 MB cap is plenty for a W9 scan
  });
  if (error) throw new Error(`createBucket(${BUCKET}) failed: ${error.message}`);
}

export type UploadW9Result = {
  storagePath: string;
  fileName: string;
  mimeType: string;
};

export async function uploadW9(
  areaManagerId: string,
  file: { name: string; type: string; bytes: ArrayBuffer | Uint8Array | Blob },
): Promise<UploadW9Result> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured — cannot upload W9.');
  }
  await ensureBucket();
  const supa = await getSupabaseServerClient();

  // Use a stable per-AM path so re-upload replaces the existing file. Keep
  // the original extension so the signed URL serves the right MIME.
  const ext = (file.name.match(/\.[A-Za-z0-9]+$/)?.[0] || '').toLowerCase();
  const safeExt = ext.length > 0 && ext.length <= 8 ? ext : '';
  const storagePath = `${areaManagerId}/w9${safeExt}`;

  const body =
    file.bytes instanceof Blob
      ? file.bytes
      : file.bytes instanceof Uint8Array
      ? file.bytes
      : new Uint8Array(file.bytes);

  const { error } = await supa.storage
    .from(BUCKET)
    .upload(storagePath, body as any, {
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  return {
    storagePath,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
  };
}

/** Returns a short-lived signed URL the browser can use to download the W9. */
export async function getW9SignedUrl(storagePath: string, ttlSeconds = 3600): Promise<string> {
  const supa = await getSupabaseServerClient();
  const { data, error } = await supa.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Signed URL failed: ${error?.message || 'no url returned'}`);
  }
  return data.signedUrl;
}

export async function deleteW9(storagePath: string): Promise<void> {
  const supa = await getSupabaseServerClient();
  const { error } = await supa.storage.from(BUCKET).remove([storagePath]);
  if (error) throw new Error(`Delete failed: ${error.message}`);
}
