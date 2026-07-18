import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const parseServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  return null;
};

const serviceAccount = parseServiceAccount();
const projectId = process.env.FIREBASE_PROJECT_ID || "swiftopsbd";
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || "swiftopsbd.firebasestorage.app";

const app = getApps()[0] || initializeApp({
  credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
  projectId,
  storageBucket,
});

export const adminAuth = getAuth(app);
export const db = getFirestore(app);
export const bucket = getStorage(app).bucket(storageBucket);
