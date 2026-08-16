export const createFirestoreRepository = (database, collectionName) => {
  if (!database?.collection) throw new TypeError("A Firestore database is required.");
  if (!collectionName) throw new TypeError("A collection name is required.");

  const collection = database.collection(collectionName);

  return Object.freeze({
    async getById(id) {
      const snapshot = await collection.doc(id).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async setById(id, value, options) {
      await collection.doc(id).set(value, options);
      return value;
    },
    async updateById(id, value) {
      await collection.doc(id).update(value);
      return value;
    },
  });
};
