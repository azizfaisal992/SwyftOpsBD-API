import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseStorage } from "./supabaseStorageService.js";

const fakeClient = ({
  uploadError = null,
  removeError = null,
  signedError = null,
} = {}) => ({
  storage: {
    from(bucket) {
      assert.equal(bucket, "private-files");
      return {
        async upload(path, buffer, options) {
          assert.equal(path, "client/user/nid-front.png");
          assert.equal(Buffer.from(buffer).toString(), "private");
          assert.equal(options.contentType, "image/png");
          assert.equal(options.upsert, false);
          return { error: uploadError };
        },
        async remove(paths) {
          assert.deepEqual(paths, ["client/user/nid-front.png"]);
          return { error: removeError };
        },
        async createSignedUrl(path, seconds) {
          assert.equal(path, "client/user/nid-front.png");
          assert.equal(seconds, 300);
          return signedError
            ? { data: null, error: signedError }
            : {
                data: { signedUrl: "https://storage.example/signed" },
                error: null,
              };
        },
      };
    },
  },
});

test("uploads, signs and deletes a private Supabase object", async () => {
  const storage = createSupabaseStorage({
    client: fakeClient(),
    bucket: "private-files",
    urlTtlSeconds: 300,
  });
  assert.deepEqual(
    await storage.save({
      storagePath: "client/user/nid-front.png",
      buffer: Buffer.from("private"),
      contentType: "image/png",
    }),
    { provider: "supabase" },
  );
  assert.deepEqual(
    await storage.signedUrl("client/user/nid-front.png"),
    {
      provider: "supabase",
      url: "https://storage.example/signed",
      expiresInSeconds: 300,
    },
  );
  await storage.remove("client/user/nid-front.png");
});

test("does not hide a Supabase upload failure", async () => {
  const storage = createSupabaseStorage({
    client: fakeClient({ uploadError: { message: "Bucket not found" } }),
    bucket: "private-files",
    urlTtlSeconds: 300,
  });
  await assert.rejects(
    storage.save({
      storagePath: "client/user/nid-front.png",
      buffer: Buffer.from("private"),
      contentType: "image/png",
    }),
    /Bucket not found/,
  );
});

