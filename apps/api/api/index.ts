/**
 * Vercel serverless entry — bundled Express app from tsup (dist/server.js).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require("../dist/server.js").default;

export default app;
