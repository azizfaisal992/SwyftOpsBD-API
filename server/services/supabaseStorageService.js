import { createClient } from "@supabase/supabase-js";

const DEFAULT_BUCKET = "swiftops-private-documents";
const DEFAULT_SIGNED_URL_SECONDS = 15 * 60;

const required = (value, name) => {
  const resolved = String(value || "").trim();
  if (!resolved) {
    throw new Error(
      `${name} is required when FILE_STORAGE_PROVIDER=supabase.`,
    );
  }
  return resolved;
};

const signedUrlSeconds = (value) => {
  const resolved = Number(value || DEFAULT_SIGNED_URL_SECONDS);
  if (!Number.isInteger(resolved) || resolved < 60 || resolved > 3600) {
    throw new Error(
      "SUPABASE_SIGNED_URL_TTL_SECONDS must be between 60 and 3600.",
    );
  }
  return resolved;
};

const storageError = (action, error) => {
  const message = error?.message || String(error || "Unknown storage error");
  return new Error(`Supabase Storage could not ${action}: ${message}`);
};

export const createSupabaseStorage = ({
  client,
  bucket = DEFAULT_BUCKET,
  urlTtlSeconds = DEFAULT_SIGNED_URL_SECONDS,
}) => ({
  async save({ storagePath, buffer, contentType, upsert = false }) {
    const { error } = await client.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType,
        cacheControl: "0",
        upsert,
      });
    if (error) throw storageError("upload the file", error);
    return { provider: "supabase" };
  },

  async remove(storagePath) {
    const { error } = await client.storage.from(bucket).remove([storagePath]);
    if (error && !/not found/i.test(error.message || "")) {
      throw storageError("delete the file", error);
    }
  },

  async signedUrl(storagePath) {
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUrl(storagePath, urlTtlSeconds);
    if (error || !data?.signedUrl) {
      throw storageError("create a private download URL", error);
    }
    return {
      provider: "supabase",
      url: data.signedUrl,
      expiresInSeconds: urlTtlSeconds,
    };
  },
});

let cachedStorage;

export const getSupabaseStorage = (source = process.env) => {
  if (cachedStorage) return cachedStorage;
  const url = required(source.SUPABASE_URL, "SUPABASE_URL");
  const secretKey = required(
    source.SUPABASE_SECRET_KEY || source.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SECRET_KEY",
  );
  const bucket = String(
    source.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET,
  ).trim();
  const client = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  cachedStorage = createSupabaseStorage({
    client,
    bucket,
    urlTtlSeconds: signedUrlSeconds(
      source.SUPABASE_SIGNED_URL_TTL_SECONDS,
    ),
  });
  return cachedStorage;
};

export const resetSupabaseStorageForTests = () => {
  cachedStorage = undefined;
};
