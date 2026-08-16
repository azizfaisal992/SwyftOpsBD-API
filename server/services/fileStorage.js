import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { bucket } from "../firebaseAdmin.js";
import { getSupabaseStorage } from "./supabaseStorageService.js";

const LOCAL_PROVIDER = "local";
const FIREBASE_PROVIDER = "firebase";
const SUPABASE_PROVIDER = "supabase";

const storageProvider = () =>
  process.env.FILE_STORAGE_PROVIDER ||
  LOCAL_PROVIDER;

const localRoot = () =>
  path.resolve(process.cwd(), process.env.LOCAL_UPLOAD_DIR || "uploads");

const resolveLocalPath = (storagePath) => {
  const root = localRoot();
  const absolutePath = path.resolve(root, storagePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid local storage path.");
  }
  return absolutePath;
};

export const savePrivateFile = async ({
  storagePath,
  buffer,
  contentType,
  metadata,
}) => {
  const provider = storageProvider();

  if (provider === LOCAL_PROVIDER) {
    const absolutePath = resolveLocalPath(storagePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
    return { provider };
  }

  if (provider === FIREBASE_PROVIDER) {
    await bucket.file(storagePath).save(buffer, {
      resumable: false,
      metadata: { contentType, metadata },
    });
    return { provider };
  }

  if (provider === SUPABASE_PROVIDER) {
    return getSupabaseStorage().save({
      storagePath,
      buffer,
      contentType,
    });
  }

  throw new Error(`Unsupported FILE_STORAGE_PROVIDER: ${provider}`);
};

export const deletePrivateFile = async (storagePath, provider) => {
  const selectedProvider = provider || storageProvider();

  if (selectedProvider === LOCAL_PROVIDER) {
    await rm(resolveLocalPath(storagePath), { force: true });
    return;
  }

  if (selectedProvider === FIREBASE_PROVIDER) {
    await bucket.file(storagePath).delete({ ignoreNotFound: true });
    return;
  }

  if (selectedProvider === SUPABASE_PROVIDER) {
    await getSupabaseStorage().remove(storagePath);
    return;
  }

  throw new Error(`Unsupported file storage provider: ${selectedProvider}`);
};

export const readPrivateFile = async (storagePath, provider) => {
  const selectedProvider = provider || storageProvider();

  if (selectedProvider === LOCAL_PROVIDER) {
    return {
      provider: selectedProvider,
      buffer: await readFile(resolveLocalPath(storagePath)),
    };
  }

  if (selectedProvider === FIREBASE_PROVIDER) {
    const [url] = await bucket.file(storagePath).getSignedUrl({
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
    });
    return { provider: selectedProvider, url };
  }

  if (selectedProvider === SUPABASE_PROVIDER) {
    return getSupabaseStorage().signedUrl(storagePath);
  }

  throw new Error(`Unsupported file storage provider: ${selectedProvider}`);
};

export const currentFileStorageProvider = storageProvider;
