import "dotenv/config";
import { setDefaultAutoSelectFamily } from "node:net";
import { createApp } from "./app.js";
import { loadEnvironment } from "./config/environment.js";

// Prefer the network family that successfully connects first. This prevents
// Firebase/Google API calls hanging on Windows networks with broken IPv6.
if (typeof setDefaultAutoSelectFamily === "function") {
  setDefaultAutoSelectFamily(true);
}

const environment = loadEnvironment();
const app = createApp({ environment });

app.listen(environment.port, () => {
  console.log(`SwiftOpsBD API listening on http://localhost:${environment.port}`);
});
