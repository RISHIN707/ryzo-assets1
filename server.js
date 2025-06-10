const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');
const os = require('os');

const app = express();
const port = process.env.PORT || 3000;

// --- Rate Limiting Middleware ---
// This helps prevent brute-force and DDoS attacks by limiting request frequency.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `windowMs`
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: 'Too many requests from this IP, please try again after 15 minutes',
});

// Apply the rate limiter to all requests
app.use(limiter);

app.get('/', (req, res) => {
  const startTime = process.hrtime();

  // A small function to format uptime into a readable string
  const formatUptime = (seconds) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);
    return `${d}d, ${h}h, ${m}m, ${s}s`;
  };

  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime(); // Uptime in seconds

  // Calculate the response time (ping)
  const diff = process.hrtime(startTime);
  const ping = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(3); // in milliseconds

  res.status(200).json({
    status: 'online',
    ping: `${ping} ms`,
    uptime: formatUptime(uptime),
    memory: {
      rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`, // Resident Set Size
      heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      external: `${(memoryUsage.external / 1024 / 1024).toFixed(2)} MB`,
    },
    serverTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    nodeVersion: process.version,
    platform: os.platform(),
  });
});

// --- Static File Serving ---
// This middleware serves files from the 'uploads' directory.
const uploadsPath = path.join(__dirname, 'uploads');
app.use(express.static(uploadsPath));

// --- Server Initialization ---
app.listen(port, () => {
  console.log(`✅ Server is running on http://localhost:${port}`);
  console.log(`Serving files from the '${uploadsPath}' directory.`);
});
