// Vercel serverless catch-all for /api/* — delegates to the Express app
// defined in /server.js. Static files in /public/ are served by Vercel's
// CDN automatically (faster than going through Express).
module.exports = require('../server.js');
