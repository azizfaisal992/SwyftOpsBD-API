import "dotenv/config";
import { adminAuth } from "../firebaseAdmin.js";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run admin:set -- admin@example.com");
  process.exit(1);
}

try {
  const user = await adminAuth.getUserByEmail(email);
  await adminAuth.setCustomUserClaims(user.uid, {
    ...user.customClaims,
    admin: true,
  });
  console.log(`Admin access enabled for ${email}. The user must sign in again to refresh their token.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
