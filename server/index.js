import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRouter } from './routes/api.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(cors({
  origin: [CLIENT_ORIGIN, 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Router
const apiConfig = {
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  getSongBpmKey: process.env.GETSONGBPM_API_KEY,
  sonovaultKey: process.env.SONOVAULT_API_KEY,
  soundNetKey: process.env.SOUNDNET_API_KEY,
  minBpm: parseFloat(process.env.BPM_MIN) || 90,
  maxBpm: parseFloat(process.env.BPM_MAX) || 180
};

app.use('/api', createApiRouter(apiConfig));

// Serve production client build if present
const clientDist = path.resolve(__dirname, '../client/dist');
app.use(express.static(clientDist));

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(clientDist, 'index.html');
  res.sendFile(indexPath, err => {
    if (err) {
      res.status(200).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Deck Order Proxy</title></head>
          <body style="background:#0c0d10;color:#e2e8f0;font-family:sans-serif;padding:2rem;">
            <h2>Deck Order Local Server Active</h2>
            <p>API endpoint is running at <code>/api/status</code>.</p>
            <p>Start frontend client with: <code>npm run client</code> (or run Vite dev server at http://localhost:5173).</p>
          </body>
        </html>
      `);
    }
  });
});

export function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`\n==================================================`);
    console.log(`🎧 DECK ORDER PROXY SERVER ACTIVE ON PORT ${port}`);
    console.log(`- API Status:    http://localhost:${port}/api/status`);
    console.log(`- Spotify App:   ${process.env.SPOTIFY_CLIENT_ID ? 'Configured ✅' : 'Missing SPOTIFY_CLIENT_ID (CSV mode active) ℹ️'}`);
    console.log(`- GetSongBPM:    ${process.env.GETSONGBPM_API_KEY ? 'Configured ✅' : 'Not configured (using cache / CSV) ℹ️'}`);
    console.log(`- Sonovault:     ${process.env.SONOVAULT_API_KEY ? 'Configured ✅' : 'Not configured (using cache / CSV) ℹ️'}`);
    console.log(`- SoundNet:      ${process.env.SOUNDNET_API_KEY ? 'Configured ($9.99/mo tier active)' : 'Unset (Optional deeper analysis)'}`);
    console.log(`- CSV Fallback:  Always Active & Guaranteed ✅`);
    console.log(`==================================================\n`);
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  startServer();
}

export default app;
