const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

// Redirect console output to log file in production
if (app.isPackaged) {
  const logPath = path.join(app.getPath('userData'), 'app.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    logStream.write(`[LOG] ${new Date().toISOString()} ${message}\n`);
    originalLog(...args);
  };

  console.error = (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    logStream.write(`[ERROR] ${new Date().toISOString()} ${message}\n`);
    originalError(...args);
  };

  console.log('='.repeat(80));
  console.log('App started:', new Date().toISOString());
  console.log('Log file:', logPath);
  console.log('User data path:', app.getPath('userData'));
  console.log('='.repeat(80));
}

const express = require('express');
const multer = require('multer');
const ws = require('ws');
const WebSocketServer = ws.WebSocketServer;
const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');
const httpProxy = require('http-proxy');

// Portable mode: determine data folder location
// In development: use project root
// In production: use 'data' folder next to the app executable
const getDataPath = () => {
  if (app.isPackaged) {
    // Production: create data folder next to the app bundle
    const exePath = app.getPath('exe');
    // On macOS: /path/to/App.app/Contents/MacOS/App -> /path/to/
    // On Windows/Linux: /path/to/App -> /path/to/
    const appDir = process.platform === 'darwin'
      ? path.dirname(path.dirname(path.dirname(exePath))) // Go up from .app/Contents/MacOS/
      : path.dirname(exePath);
    return path.join(appDir, 'data');
  } else {
    // Development: use project root
    return path.join(__dirname, '..');
  }
};

const dataFolder = getDataPath();
console.log('[INIT] Data folder:', dataFolder);
if (!fs.existsSync(dataFolder)) {
  fs.mkdirSync(dataFolder, { recursive: true });
  console.log('[INIT] Created data folder');
}

// Initialize database in data folder
const dbPath = path.join(dataFolder, 'web-projector.db');
console.log('[INIT] Database path:', dbPath);

let db;
try {
  db = new Database(dbPath);
  console.log('[INIT] Database opened successfully');
} catch (err) {
  console.error('[INIT] Failed to open database:', err);
  // Log more details about the error
  console.error('[INIT] Error details:', {
    message: err.message,
    stack: err.stack,
    dbPath: dbPath,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  });
  throw new Error(`Failed to open database at ${dbPath}: ${err.message}`);
}

// Setup images folder in data folder
const imagesFolder = path.join(dataFolder, 'images');
if (!fs.existsSync(imagesFolder)) {
  fs.mkdirSync(imagesFolder, { recursive: true });
}

// Setup fonts folder in data folder (served to clients)
const fontsFolder = path.join(dataFolder, 'fonts');
if (!fs.existsSync(fontsFolder)) {
  fs.mkdirSync(fontsFolder, { recursive: true });
}

// Setup multer for image uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, imagesFolder);
    },
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      cb(null, `image-${timestamp}.jpg`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG files are allowed'), false);
    }
  }
});

// Ensure all database tables exist
try {
  console.log('[INIT] Creating database tables...');

  // Ensure songs table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      lyrics TEXT,
      chords TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure slides table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure playlists table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      type TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);

  // Ensure settings table exists for storing app state
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  console.log('[INIT] Database tables created successfully');
} catch (err) {
  console.error('[INIT] Failed to create database tables:', err);
  throw new Error(`Failed to create database tables: ${err.message}`);
}

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

let httpServer = null;
let wss = null;
let expressApp = null;
let viteWsProxy = null;

// Store current state for syncing
let currentState = {
  songs: [],
  slides: [],
  songItems: [],
  slideItems: [],
  selectedLiveItem: null,
  settings: {
    liveBackgroundColor: '#000000',
    liveBackgroundImage: null
  }
};

// Load initial state
function loadInitialState() {
  console.log('[STATE] Loading initial state from database...');

  // Declare settingsStmt outside try block so it's accessible throughout function
  let settingsStmt;

  try {
    console.log('[STATE] Preparing SELECT songs statement...');
    const songsStmt = db.prepare('SELECT * FROM songs ORDER BY title');

    console.log('[STATE] Preparing SELECT slides statement...');
    const slidesStmt = db.prepare('SELECT * FROM slides ORDER BY title');

    console.log('[STATE] Preparing SELECT playlists statements...');
    const songPlaylistStmt = db.prepare('SELECT data FROM playlists WHERE type = ?');
    const slidePlaylistStmt = db.prepare('SELECT data FROM playlists WHERE type = ?');

    console.log('[STATE] Preparing SELECT settings statement...');
    settingsStmt = db.prepare('SELECT value FROM settings WHERE key = ?');

    console.log('[STATE] Executing songs query...');
    currentState.songs = songsStmt.all();

    console.log('[STATE] Executing slides query...');
    currentState.slides = slidesStmt.all();

    console.log(`[STATE] Loaded ${currentState.songs.length} songs, ${currentState.slides.length} slides`);

    console.log('[STATE] Loading song playlist...');
    const songRow = songPlaylistStmt.get('songs');

    console.log('[STATE] Loading slide playlist...');
    const slideRow = slidePlaylistStmt.get('slides');

    // Hydrate playlist items with current data from database
    const savedSongItems = songRow ? JSON.parse(songRow.data) : [];
    currentState.songItems = savedSongItems.map(item => {
      const song = currentState.songs.find(s => s.id === item.id);
      if (song) {
        return { id: song.id, text: song.title, songData: song };
      }
      // If song no longer exists, keep the placeholder
      return item;
    });

    const savedSlideItems = slideRow ? JSON.parse(slideRow.data) : [];
    currentState.slideItems = savedSlideItems.map(item => {
      const slide = currentState.slides.find(s => s.id === item.id);
      if (slide) {
        return { id: slide.id, text: slide.title, slideData: slide };
      }
      // If slide no longer exists, keep the placeholder
      return item;
    });

    console.log(`[STATE] Loaded ${currentState.songItems.length} song items, ${currentState.slideItems.length} slide items`);
  } catch (err) {
    console.error('[STATE] Failed to load initial state:', err);
    // Initialize with empty state on error
    currentState.songs = [];
    currentState.slides = [];
    currentState.songItems = [];
    currentState.slideItems = [];
    // Re-prepare settingsStmt if it failed
    try {
      settingsStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    } catch (e) {
      console.error('[STATE] Failed to prepare settingsStmt:', e);
    }
  }

  // Load selected live item
  try {
    console.log('[STATE] Loading selected live item...');
    if (!settingsStmt) {
      console.log('[STATE] Preparing settingsStmt for selectedLiveItem...');
      settingsStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    }
    console.log('[STATE] Querying selectedLiveItem from settings...');
    const selectedRow = settingsStmt.get('selectedLiveItem');
    console.log('[STATE] selectedRow:', selectedRow ? 'found' : 'null');
    if (selectedRow) {
      const savedItem = JSON.parse(selectedRow.value);
      // savedItem should be { id, type } - reconstruct full object from database
      if (savedItem && savedItem.id && savedItem.type) {
        if (savedItem.type === 'song') {
          const songStmt = db.prepare('SELECT * FROM songs WHERE id = ?');
          const songData = songStmt.get(savedItem.id);
          if (songData) {
            currentState.selectedLiveItem = { songData, id: songData.id };
          } else {
            currentState.selectedLiveItem = null;
          }
        } else if (savedItem.type === 'slide') {
          const slideStmt = db.prepare('SELECT * FROM slides WHERE id = ?');
          const slideData = slideStmt.get(savedItem.id);
          if (slideData) {
            currentState.selectedLiveItem = { slideData, id: slideData.id };
          } else {
            currentState.selectedLiveItem = null;
          }
        } else {
          currentState.selectedLiveItem = null;
        }
      } else {
        currentState.selectedLiveItem = null;
      }
    } else {
      currentState.selectedLiveItem = null;
    }
  } catch (err) {
    console.error('Error loading selected live item:', err);
    currentState.selectedLiveItem = null;
  }

  // Load app settings (background color/image - dark mode is per-device in localStorage)
  try {
    console.log('[STATE] Loading app settings...');
    if (!settingsStmt) {
      console.log('[STATE] Preparing settingsStmt for appSettings...');
      settingsStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    }
    console.log('[STATE] Querying appSettings from settings...');
    const settingsRow = settingsStmt.get('appSettings');
    console.log('[STATE] appSettings row:', settingsRow ? 'found' : 'null');
    if (settingsRow) {
      const savedSettings = JSON.parse(settingsRow.value);
      currentState.settings = {
        liveBackgroundColor: savedSettings.liveBackgroundColor ?? '#000000',
        liveBackgroundImage: savedSettings.liveBackgroundImage ?? null,
        fontFamily: savedSettings.fontFamily ?? '',
        fontStyle: savedSettings.fontStyle ?? 'normal' // 'normal', 'bold', 'italic', 'bold-italic'
      };
    }
  } catch (err) {
    console.error('Error loading app settings:', err);
  }

  console.log('[STATE] ✅ Initial state loaded successfully');
}

async function startServer(port) {
  if (httpServer) {
    console.log('Server already running');
    return;
  }

  // Load initial state
  loadInitialState();

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  // Create proxy for Vite HMR WebSocket in dev mode
  if (isDev) {
    viteWsProxy = httpProxy.createProxyServer({ target: 'ws://localhost:5173', ws: true });
  }

    // Create Express app
    expressApp = express();
    expressApp.use(express.json());

    // Disable caching for development so clients always fetch fresh assets
    expressApp.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      next();
    });

    // Serve fonts folder statically at /fonts
    expressApp.use('/fonts', express.static(fontsFolder));

    // Endpoint to list available fonts (scans fontsFolder)
    expressApp.get('/api/fonts', (req, res) => {
      try {
        const files = fs.readdirSync(fontsFolder || '.');
        const fontFiles = files.filter(f => /\.(ttf|otf|woff2?|eot)$/i.test(f));
        const fonts = fontFiles.map(f => {
          const family = path.parse(f).name; // infer family from filename
          return { filename: f, family, url: `/fonts/${encodeURIComponent(f)}` };
        });
        res.json(fonts);
      } catch (err) {
        console.error('Error reading fonts folder:', err);
        res.json([]);
      }
    });

    // API endpoints for data operations
    expressApp.get('/api/songs', (req, res) => {
      res.json(currentState.songs);
    });

    // Create new song
    expressApp.post('/api/songs', (req, res) => {
      try {
        const { title, lyrics, chords } = req.body || {};
        const stmt = db.prepare('INSERT INTO songs (title, lyrics, chords) VALUES (?, ?, ?)');
        const info = stmt.run(title || 'Untitled', lyrics || '', chords || '');
        const songStmt = db.prepare('SELECT * FROM songs WHERE id = ?');
        const song = songStmt.get(info.lastInsertRowid);

        // Reload songs into current state
        const songsStmt = db.prepare('SELECT * FROM songs ORDER BY title');
        currentState.songs = songsStmt.all();

        // Broadcast to all clients
        broadcastToAll({ type: 'songs', data: currentState.songs });

        res.json(song);
      } catch (err) {
        console.error('Error creating song:', err);
        res.status(500).json({ error: 'Failed to create song' });
      }
    });

    expressApp.get('/api/slides', (req, res) => {
      res.json(currentState.slides);
    });

    // Create new slide
    expressApp.post('/api/slides', (req, res) => {
      try {
        const { title, content } = req.body || {};
        const stmt = db.prepare('INSERT INTO slides (title, content) VALUES (?, ?)');
        const info = stmt.run(title || 'Untitled', content || '');
        const slideStmt = db.prepare('SELECT * FROM slides WHERE id = ?');
        const slide = slideStmt.get(info.lastInsertRowid);

        // Reload slides into current state
        const slidesStmt = db.prepare('SELECT * FROM slides ORDER BY title');
        currentState.slides = slidesStmt.all();

        // Broadcast to all clients
        broadcastToAll({ type: 'slides', data: currentState.slides });

        res.json(slide);
      } catch (err) {
        console.error('Error creating slide:', err);
        res.status(500).json({ error: 'Failed to create slide' });
      }
    });

    expressApp.get('/api/playlist/:type', (req, res) => {
      const type = req.params.type;
      res.json(type === 'songs' ? currentState.songItems : currentState.slideItems);
    });

    expressApp.post('/api/playlist/:type', (req, res) => {
      const type = req.params.type;
      const data = req.body;

      // Update database
      const stmt = db.prepare('INSERT OR REPLACE INTO playlists (type, data) VALUES (?, ?)');
      stmt.run(type, JSON.stringify(data));

      // Update state
      if (type === 'songs') {
        currentState.songItems = data;
      } else {
        currentState.slideItems = data;
      }

      // Broadcast to all clients
      broadcastToAll({
        type: type === 'songs' ? 'songItems' : 'slideItems',
        data: data
      });

      res.json({ success: true });
    });

    // Get individual song by ID
    expressApp.get('/api/songs/:id', (req, res) => {
      const id = parseInt(req.params.id);
      const stmt = db.prepare('SELECT * FROM songs WHERE id = ?');
      const song = stmt.get(id);
      if (song) {
        res.json(song);
      } else {
        res.status(404).json({ error: 'Song not found' });
      }
    });

    // Update individual song
    expressApp.put('/api/songs/:id', (req, res) => {
      const id = parseInt(req.params.id);
      const { title, lyrics, chords } = req.body;

      try {
        const stmt = db.prepare('UPDATE songs SET title = ?, lyrics = ?, chords = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        const result = stmt.run(title, lyrics, chords, id);

        if (result.changes === 0) {
          return res.status(404).json({ error: 'Song not found' });
        }

        // Reload songs into current state
        const songsStmt = db.prepare('SELECT * FROM songs ORDER BY title');
        currentState.songs = songsStmt.all();

        // Broadcast to all clients
        broadcastToAll({
          type: 'songs',
          data: currentState.songs
        });

        res.json({ success: true });
      } catch (err) {
        console.error('Error updating song:', err);
        res.status(500).json({ error: 'Failed to update song' });
      }
    });

    // Delete individual song
    expressApp.delete('/api/songs/:id', (req, res) => {
      const id = parseInt(req.params.id);
      try {
        const stmt = db.prepare('DELETE FROM songs WHERE id = ?');
        const result = stmt.run(id);
        if (result.changes === 0) {
          return res.status(404).json({ error: 'Song not found' });
        }

        // Remove from playlists if present
        try {
          const playlistStmt = db.prepare('SELECT data FROM playlists WHERE type = ?');
          const row = playlistStmt.get('songs');
          if (row) {
            const items = JSON.parse(row.data).filter(it => it.id !== id);
            const up = db.prepare('INSERT OR REPLACE INTO playlists (type, data) VALUES (?, ?)');
            up.run('songs', JSON.stringify(items));
            currentState.songItems = currentState.songItems.filter(i => i.id !== id);
          }
        } catch (e) {
          console.error('Error updating playlists after song delete:', e);
        }

        // Reload songs into current state
        const songsStmt = db.prepare('SELECT * FROM songs ORDER BY title');
        currentState.songs = songsStmt.all();

        // Broadcast to all clients
        broadcastToAll({ type: 'songs', data: currentState.songs });
        broadcastToAll({ type: 'songItems', data: currentState.songItems });

        res.json({ success: true });
      } catch (err) {
        console.error('Error deleting song:', err);
        res.status(500).json({ error: 'Failed to delete song' });
      }
    });

    // Get individual slide by ID
    expressApp.get('/api/slides/:id', (req, res) => {
      const id = parseInt(req.params.id);
      const stmt = db.prepare('SELECT * FROM slides WHERE id = ?');
      const slide = stmt.get(id);
      if (slide) {
        res.json(slide);
      } else {
        res.status(404).json({ error: 'Slide not found' });
      }
    });

    // Update individual slide
    expressApp.put('/api/slides/:id', (req, res) => {
      const id = parseInt(req.params.id);
      const { title, content } = req.body;

      console.log(`[API] PUT /api/slides/${id}`, { title, content: content?.substring(0, 50) + '...' });

      try {
        const stmt = db.prepare('UPDATE slides SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        const result = stmt.run(title, content, id);

        console.log(`[API] Update result:`, { changes: result.changes });

        if (result.changes === 0) {
          console.error(`[API] Slide ${id} not found in database`);
          return res.status(404).json({ error: 'Slide not found' });
        }

        // Reload slides into current state
        const slidesStmt = db.prepare('SELECT * FROM slides ORDER BY title');
        currentState.slides = slidesStmt.all();

        console.log(`[API] Broadcasting slide update to all clients`);

        // Broadcast to all clients
        broadcastToAll({
          type: 'slides',
          data: currentState.slides
        });

        res.json({ success: true });
      } catch (err) {
        console.error('[API] Error updating slide:', err);
        res.status(500).json({ error: 'Failed to update slide' });
      }
    });

    // Delete individual slide
    expressApp.delete('/api/slides/:id', (req, res) => {
      const id = parseInt(req.params.id);
      try {
        const stmt = db.prepare('DELETE FROM slides WHERE id = ?');
        const result = stmt.run(id);
        if (result.changes === 0) {
          return res.status(404).json({ error: 'Slide not found' });
        }

        // Remove from playlists if present
        try {
          const playlistStmt = db.prepare('SELECT data FROM playlists WHERE type = ?');
          const row = playlistStmt.get('slides');
          if (row) {
            const items = JSON.parse(row.data).filter(it => it.id !== id);
            const up = db.prepare('INSERT OR REPLACE INTO playlists (type, data) VALUES (?, ?)');
            up.run('slides', JSON.stringify(items));
            currentState.slideItems = currentState.slideItems.filter(i => i.id !== id);
          }
        } catch (e) {
          console.error('Error updating playlists after slide delete:', e);
        }

        // Reload slides into current state
        const slidesStmt = db.prepare('SELECT * FROM slides ORDER BY title');
        currentState.slides = slidesStmt.all();

        // Broadcast to all clients
        broadcastToAll({ type: 'slides', data: currentState.slides });
        broadcastToAll({ type: 'slideItems', data: currentState.slideItems });

        res.json({ success: true });
      } catch (err) {
        console.error('Error deleting slide:', err);
        res.status(500).json({ error: 'Failed to delete slide' });
      }
    });

    // Get selected live item
    expressApp.get('/api/selected-live-item', (req, res) => {
      try {
        const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
        const row = stmt.get('selectedLiveItem');
        if (row) {
          const savedItem = JSON.parse(row.value);
          // Reconstruct full object from database
          if (savedItem && savedItem.id && savedItem.type) {
            if (savedItem.type === 'song') {
              const songStmt = db.prepare('SELECT * FROM songs WHERE id = ?');
              const songData = songStmt.get(savedItem.id);
              if (songData) {
                res.json({ songData, id: songData.id });
              } else {
                res.json(null);
              }
            } else if (savedItem.type === 'slide') {
              const slideStmt = db.prepare('SELECT * FROM slides WHERE id = ?');
              const slideData = slideStmt.get(savedItem.id);
              if (slideData) {
                res.json({ slideData, id: slideData.id });
              } else {
                res.json(null);
              }
            } else {
              res.json(null);
            }
          } else {
            res.json(null);
          }
        } else {
          res.json(null);
        }
      } catch (err) {
        console.error('Error fetching selected live item:', err);
        res.json(null);
      }
    });

    // Set selected live item
    expressApp.post('/api/selected-live-item', (req, res) => {
      try {
        const selectedItem = req.body;

        // Extract only ID and type to save (not full content)
        let itemToSave = null;
        if (selectedItem) {
          const id = selectedItem.id;
          const type = selectedItem.songData ? 'song' : 'slide';
          itemToSave = { id, type };
        }

        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        stmt.run('selectedLiveItem', JSON.stringify(itemToSave));

        // Broadcast to all clients (with full object)
        broadcastToAll({
          type: 'selectedLiveItem',
          data: selectedItem
        });

        res.json({ success: true });
      } catch (err) {
        console.error('Error saving selected live item:', err);
        res.status(500).json({ error: 'Failed to save selected live item' });
      }
    });

    // Get app settings (theme, background, etc.)
    expressApp.get('/api/settings', (req, res) => {
      res.json(currentState.settings);
    });

    // Update app settings (dark mode is NOT saved here, it's per-device in localStorage)
    expressApp.put('/api/settings', (req, res) => {
      try {
        const newSettings = req.body;

        // Update in-memory state (dark mode excluded)
        currentState.settings = {
          liveBackgroundColor: newSettings.liveBackgroundColor ?? currentState.settings.liveBackgroundColor,
          liveBackgroundImage: newSettings.liveBackgroundImage ?? currentState.settings.liveBackgroundImage
        };

        // Save to database
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        stmt.run('appSettings', JSON.stringify(currentState.settings));

        // Broadcast to all clients
        broadcastToAll({
          type: 'settings',
          data: currentState.settings
        });

        res.json({ success: true });
      } catch (err) {
        console.error('Error saving settings:', err);
        res.status(500).json({ error: 'Failed to save settings' });
      }
    });

    // Test endpoint to verify API works
    expressApp.get('/api/test', (req, res) => {
      res.json({ status: 'ok', message: 'API server is working' });
    });

    // Background image endpoints
    expressApp.post('/api/bkgimages/upload', upload.single('file'), (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      res.json({
        success: true,
        filename: req.file.filename,
        path: `/api/bkgimages/${req.file.filename}`
      });
    });

    expressApp.get('/api/bkgimages', (req, res) => {
      try {
        const files = fs.readdirSync(imagesFolder)
          .filter(file => file.startsWith('image-') && file.endsWith('.jpg'))
          .map(file => ({
            filename: file,
            path: `/api/bkgimages/${file}`,
            created: fs.statSync(path.join(imagesFolder, file)).birthtime
          }))
          .sort((a, b) => b.created - a.created);
        res.json(files);
      } catch (err) {
        res.status(500).json({ error: 'Failed to read background images' });
      }
    });

    expressApp.get('/api/bkgimages/:filename', (req, res) => {
      const filename = req.params.filename;
      // Validate filename to prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      const filePath = path.join(imagesFolder, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Background image not found' });
      }
      res.sendFile(filePath);
    });

    expressApp.delete('/api/bkgimages/:filename', (req, res) => {
      const filename = req.params.filename;
      // Validate filename to prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      const filePath = path.join(imagesFolder, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Background image not found' });
      }
      try {
        fs.unlinkSync(filePath);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete background image' });
      }
    });

    // Serve the React app build files or proxy to Vite in development
    const clientPath = path.join(__dirname, '../dist');

    // In development mode, ALWAYS proxy to Vite (even if dist exists)
    if (isDev && createProxyMiddleware) {
      // In development, proxy requests to Vite dev server
      console.log('[SERVER] Development mode: proxying to Vite on http://localhost:5173');
      expressApp.use('/', createProxyMiddleware({
        target: 'http://localhost:5173',
        changeOrigin: true,
        ws: false,  // Manual WebSocket handling below
        onProxyRes: (proxyRes, req, res) => {
          proxyRes.headers['cache-control'] = 'no-store, must-revalidate';
          proxyRes.headers['pragma'] = 'no-cache';
          proxyRes.headers['expires'] = '0';
        }
      }));
    } else {
      // Production mode: serve static build with no-cache headers
      console.log('[SERVER] Production mode: serving static files from dist/');
      console.log('[SERVER] Client path:', clientPath);

      // Read index.html once at startup
      const indexPath = path.join(clientPath, 'index.html');
      let indexHtml;

      try {
        indexHtml = fs.readFileSync(indexPath, 'utf8');
        console.log('[SERVER] Loaded index.html successfully');
      } catch (err) {
        console.error('[SERVER] Failed to load index.html:', err);
        throw new Error('Failed to load index.html from dist folder');
      }

      // Serve static assets
      expressApp.use(express.static(clientPath, {
        setHeaders: (res, filePath) => {
          res.setHeader('Cache-Control', 'no-store, must-revalidate');
        }
      }));

      // Fallback for SPA routing - serve index.html for all non-API routes
      expressApp.use((req, res, next) => {
        // Don't intercept API routes
        if (req.path.startsWith('/api/')) {
          return next();
        }

        // For all other routes, serve index.html
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.type('html').send(indexHtml);
      });

      console.log('[SERVER] Static file serving configured successfully');
    }

    // Create HTTP server
    httpServer = http.createServer(expressApp);

    // Create WebSocket server on /ws path
    wss = new WebSocketServer({ noServer: true });

    // Handle WebSocket upgrade - /ws for app, others for Vite HMR
    httpServer.on('upgrade', (request, socket, head) => {
      const url = request.url;
      console.log('[UPGRADE] Request:', url, 'Headers:', request.headers.upgrade);

      // Parse URL to check path without query params
      const pathname = url.split('?')[0];

      if (pathname === '/ws') {
        // App WebSocket
        console.log('[UPGRADE] Handling /ws for app WebSocket');
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } else if (isDev && viteWsProxy) {
        // Proxy Vite HMR WebSocket to port 5173
        console.log('[UPGRADE] Proxying to Vite:', url);
        viteWsProxy.ws(request, socket, head);
      } else {
        console.log('[UPGRADE] Destroying unknown connection:', url);
        socket.destroy();
      }
    });

    // Handle WebSocket connections
    wss.on('connection', (ws) => {
      console.log('Client connected to /ws');

      // Send full state to newly connected client
      try {
        const stateMessage = JSON.stringify({
          type: 'fullState',
          data: currentState
        });
        console.log('Sending initial state, size:', stateMessage.length, 'bytes');
        ws.send(stateMessage);
        console.log('Initial state sent successfully');
      } catch (err) {
        console.error('Error sending initial state:', err);
        console.error('Current state:', currentState);
      }

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          console.log('Received from client:', data);

          // Handle different message types from clients
          handleClientMessage(data, ws);
        } catch (err) {
          console.error('Error parsing message:', err);
        }
      });

      ws.on('close', (code, reason) => {
        console.log('Client disconnected:', code, reason.toString());
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    // Start server
  await new Promise((resolve, reject) => {
    httpServer.listen(port, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log(`Server started on port ${port}`);
  console.log(`View at: http://localhost:${port}`);
  console.log(`WebSocket endpoint: ws://localhost:${port}/ws`);
  console.log(`Upgrade listeners registered:`, httpServer.listenerCount('upgrade'));
}

function handleClientMessage(data, ws) {
  switch (data.type) {
    case 'updatePlaylist':
      // Update playlist in database
      // Strip out full content, save only id and text
      const minimalItems = data.items.map(item => ({
        id: item.id,
        text: item.text
      }));

      const stmt = db.prepare('INSERT OR REPLACE INTO playlists (type, data) VALUES (?, ?)');
      stmt.run(data.playlistType, JSON.stringify(minimalItems));

      // Update state with full objects (for broadcasting)
      if (data.playlistType === 'songs') {
        currentState.songItems = data.items;
      } else {
        currentState.slideItems = data.items;
      }

      // Broadcast to all other clients (excluding sender)
      broadcastToAllExcept(ws, {
        type: data.playlistType === 'songs' ? 'songItems' : 'slideItems',
        data: data.items
      });
      break;

    case 'updateSelectedLiveItem':
      // Update selected live item in database
      try {
        // Extract only ID and type to save (not full content)
        let itemToSave = null;
        if (data.selectedItem) {
          const id = data.selectedItem.id;
          const type = data.selectedItem.songData ? 'song' : 'slide';
          itemToSave = { id, type };
        }

        const settingsStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        settingsStmt.run('selectedLiveItem', JSON.stringify(itemToSave));

        // Update state with full object (for broadcasting)
        currentState.selectedLiveItem = data.selectedItem;

        // Broadcast to all other clients (excluding sender)
        broadcastToAllExcept(ws, {
          type: 'selectedLiveItem',
          data: data.selectedItem
        });
      } catch (err) {
        console.error('Error updating selected live item:', err);
      }
      break;

    case 'updateSettings':
      // Update app settings in database (dark mode is NOT saved, it's per-device in localStorage)
      try {
        // Update in-memory state (dark mode excluded)
        currentState.settings = {
          liveBackgroundColor: data.settings.liveBackgroundColor ?? currentState.settings.liveBackgroundColor,
          liveBackgroundImage: data.settings.liveBackgroundImage ?? currentState.settings.liveBackgroundImage,
          fontFamily: data.settings.fontFamily ?? currentState.settings.fontFamily,
          fontStyle: data.settings.fontStyle ?? currentState.settings.fontStyle
        };

        // Save to database
        const settingsStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        settingsStmt.run('appSettings', JSON.stringify(currentState.settings));

        // Broadcast to all other clients (excluding sender)
        broadcastToAllExcept(ws, {
          type: 'settings',
          data: currentState.settings
        });
      } catch (err) {
        console.error('Error updating settings:', err);
      }
      break;

    case 'requestState':
      // Send current state to requesting client
      ws.send(JSON.stringify({
        type: 'fullState',
        data: currentState
      }));
      break;
  }
}

function broadcastToAll(message) {
  if (!wss) return;

  const messageStr = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(messageStr);
    }
  });
}

function broadcastToAllExcept(excludeWs, message) {
  if (!wss) return;

  const messageStr = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === 1) { // WebSocket.OPEN
      client.send(messageStr);
    }
  });
}


// ============================================================================
// ELECTRON WINDOW SETUP
// ============================================================================

function createWindow() {
  console.log('[WINDOW] Creating main window...');

  // Attempt to restore saved window bounds from settings
  let savedBounds = null;
  try {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get('windowBounds');
    if (row && row.value) {
      savedBounds = JSON.parse(row.value);
      console.log('[WINDOW] Restored saved bounds:', savedBounds);
    }
  } catch (err) {
    console.error('[WINDOW] Error reading saved window bounds:', err);
    savedBounds = null;
  }

  // Validate bounds are on a connected display
  const isBoundsVisible = (b) => {
    if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' || typeof b.width !== 'number' || typeof b.height !== 'number') return false;
    try {
      const displays = screen.getAllDisplays();
      for (const d of displays) {
        const wa = d.workArea; // { x, y, width, height }
        // Check if the center point of the bounds is within this work area
        const cx = b.x + Math.floor(b.width / 2);
        const cy = b.y + Math.floor(b.height / 2);
        if (cx >= wa.x && cx <= wa.x + wa.width && cy >= wa.y && cy <= wa.y + wa.height) return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  };

  const windowOpts = savedBounds && isBoundsVisible(savedBounds)
    ? { x: savedBounds.x, y: savedBounds.y, width: savedBounds.width, height: savedBounds.height }
    : { width: 1200, height: 800 };

  const mainWindow = new BrowserWindow(Object.assign({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  }, windowOpts));

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  console.log('[WINDOW] isDev:', isDev, 'isPackaged:', app.isPackaged);

  // In development, load from Vite dev server (5173), in production load from Express (5555)
  if (isDev) {
    console.log('[WINDOW] Loading from Vite dev server: http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    console.log('[WINDOW] Loading from Express server: http://localhost:5555');
    mainWindow.loadURL('http://localhost:5555');
  }

  console.log('[WINDOW] Main window created successfully');

  // Persist window bounds on move/resize (debounced) and on close
  let saveTimeout = null;
  const saveBounds = () => {
    try {
      const b = mainWindow.getBounds();
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      stmt.run('windowBounds', JSON.stringify(b));
      // Also update in-memory settings
      currentState.settings.windowBounds = b;
    } catch (err) {
      console.error('Failed to save window bounds:', err);
    }
  };

  const scheduleSave = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveBounds, 300);
  };

  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveBounds();
  });
}

app.whenReady().then(async () => {
  try {
    await startServer(5555);
    createWindow();
  } catch (err) {
    console.error('Failed to start app:', err);
    // Show error dialog to user
    const { dialog } = require('electron');
    dialog.showErrorBox('Startup Error', `Failed to start Web Projector:\n\n${err.message}\n\nCheck console for details.`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Stop server and close database
  if (wss) {
    wss.clients.forEach(client => client.close());
    wss.close();
  }
  if (httpServer) {
    httpServer.close();
  }
  db.close();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});