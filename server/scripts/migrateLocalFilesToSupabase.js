import "dotenv/config";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../firebaseAdmin.js";
import { getSupabaseStorage } from "../services/supabaseStorageService.js";

const APPLY = process.argv.includes("--apply");
const LOCAL_ROOT = path.resolve(
  process.cwd(),
  process.env.LOCAL_UPLOAD_DIR || "uploads",
);
const COLLECTIONS = [
  "caregiverOnboarding",
  "clientOnboarding",
  "clientMedicalDocuments",
];

const localFile = (storagePath) => {
  const absolute = path.resolve(LOCAL_ROOT, storagePath);
  if (
    absolute !== LOCAL_ROOT &&
    !absolute.startsWith(`${LOCAL_ROOT}${path.sep}`)
  ) {
    throw new Error(`Unsafe storage path: ${storagePath}`);
  }
  return absolute;
};

const isPlainObject = (value) =>
  value &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;

const fileMetadata = (value) =>
  isPlainObject(value) &&
  typeof value.storagePath === "string" &&
  (!value.storageProvider || value.storageProvider === "local");

const walkFiles = (value, found = []) => {
  if (Array.isArray(value)) {
    value.forEach((item) => walkFiles(item, found));
  } else if (fileMetadata(value)) {
    found.push(value);
  } else if (isPlainObject(value)) {
    Object.values(value).forEach((item) => walkFiles(item, found));
  }
  return found;
};

const main = async () => {
  const storage = APPLY ? getSupabaseStorage() : null;
  const stats = { discovered: 0, migrated: 0, missing: 0, documents: 0 };
  for (const collectionName of COLLECTIONS) {
    const snapshot = await db.collection(collectionName).limit(500).get();
    for (const document of snapshot.docs) {
      const data = document.data();
      const files = walkFiles(data);
      if (!files.length) continue;
      stats.documents += 1;
      let changed = false;
      for (const metadata of files) {
        stats.discovered += 1;
        const absolutePath = localFile(metadata.storagePath);
        try {
          await access(absolutePath);
        } catch {
          stats.missing += 1;
          console.warn(
            `Missing local file: ${collectionName}/${document.id} ` +
            `(${metadata.storagePath})`,
          );
          continue;
        }
        if (!APPLY) {
          console.log(
            `Would migrate: ${collectionName}/${document.id} ` +
            `(${metadata.storagePath})`,
          );
          continue;
        }
        await storage.save({
          storagePath: metadata.storagePath,
          buffer: await readFile(absolutePath),
          contentType:
            metadata.type ||
            metadata.contentType ||
            "application/octet-stream",
          upsert: true,
        });
        metadata.storageProvider = "supabase";
        changed = true;
        stats.migrated += 1;
      }
      if (changed) await document.ref.set(data);
    }
  }
  console.log(JSON.stringify({ apply: APPLY, ...stats }, null, 2));
  if (!APPLY) {
    console.log(
      "Dry run only. Run `npm run storage:migrate -- --apply` after checking " +
      "the listed files and Supabase secrets.",
    );
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

