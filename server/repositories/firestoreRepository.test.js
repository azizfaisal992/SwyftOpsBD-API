import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreRepository } from "./firestoreRepository.js";

const createFakeDatabase = (records = {}) => ({
  collection(collectionName) {
    return {
      doc(id) {
        return {
          async get() {
            const value = records[`${collectionName}/${id}`];
            return { exists: value !== undefined, data: () => value };
          },
          async set(value) {
            records[`${collectionName}/${id}`] = value;
          },
          async update(value) {
            records[`${collectionName}/${id}`] = {
              ...records[`${collectionName}/${id}`],
              ...value,
            };
          },
        };
      },
    };
  },
});

test("repository reads, writes and updates through an injected database", async () => {
  const records = {};
  const repository = createFirestoreRepository(
    createFakeDatabase(records),
    "users",
  );

  assert.equal(await repository.getById("user-1"), null);
  await repository.setById("user-1", { role: "client", active: true });
  assert.deepEqual(await repository.getById("user-1"), {
    role: "client",
    active: true,
  });
  await repository.updateById("user-1", { active: false });
  assert.deepEqual(await repository.getById("user-1"), {
    role: "client",
    active: false,
  });
});

test("repository requires explicit dependencies", () => {
  assert.throws(() => createFirestoreRepository(null, "users"), /Firestore/);
  assert.throws(
    () => createFirestoreRepository(createFakeDatabase(), ""),
    /collection name/,
  );
});
