const { app, BrowserWindow } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const express = require('express');
const multer = require('multer');
const ws = require('ws');
const WebSocketServer = ws.WebSocketServer;
const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');
const httpProxy = require('http-proxy');

// Initialize database - point to your existing database file
const dbPath = path.join(__dirname, '../web-projector.db');
const db = new Database(dbPath);

// Setup thumbnails folder
const thumbnailsFolder = path.join(app.getPath('userData'), 'thumbnails');
if (!fs.existsSync(thumbnailsFolder)) {
  fs.mkdirSync(thumbnailsFolder, { recursive: true });
}

// Setup multer for thumbnail uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, thumbnailsFolder);
    },
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      cb(null, `thumbnail-${timestamp}.jpg`);
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
  const songsStmt = db.prepare('SELECT * FROM songs ORDER BY title');
  const slidesStmt = db.prepare('SELECT * FROM slides ORDER BY title');
  const songPlaylistStmt = db.prepare('SELECT data FROM playlists WHERE type = ?');
  const slidePlaylistStmt = db.prepare('SELECT data FROM playlists WHERE type = ?');
  const settingsStmt = db.prepare('SELECT value FROM settings WHERE key = ?');

  currentState.songs = songsStmt.all();
  currentState.slides = slidesStmt.all();

  const songRow = songPlaylistStmt.get('songs');
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

  // Load selected live item
  try {
    const selectedRow = settingsStmt.get('selectedLiveItem');
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
    const settingsRow = settingsStmt.get('appSettings');
    if (settingsRow) {
      const savedSettings = JSON.parse(settingsRow.value);
      currentState.settings = {
        liveBackgroundColor: savedSettings.liveBackgroundColor ?? '#000000',
        liveBackgroundImage: savedSettings.liveBackgroundImage ?? null
      };
    }
  } catch (err) {
    console.error('Error loading app settings:', err);
  }
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

    // API endpoints for data operations
    expressApp.get('/api/songs', (req, res) => {
      res.json(currentState.songs);
    });

    expressApp.get('/api/slides', (req, res) => {
      res.json(currentState.slides);
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
      const { title, lyrics } = req.body;

      try {
        const stmt = db.prepare('UPDATE songs SET title = ?, lyrics = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        const result = stmt.run(title, lyrics, id);

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

    // Thumbnail endpoints
    expressApp.post('/api/thumbnails/upload', upload.single('file'), (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      res.json({ 
        success: true, 
        filename: req.file.filename,
        path: `/api/thumbnails/${req.file.filename}`
      });
    });

    expressApp.get('/api/thumbnails', (req, res) => {
      try {
        const files = fs.readdirSync(thumbnailsFolder)
          .filter(file => file.startsWith('thumbnail-') && file.endsWith('.jpg'))
          .map(file => ({
            filename: file,
            path: `/api/thumbnails/${file}`,
            created: fs.statSync(path.join(thumbnailsFolder, file)).birthtime
          }))
          .sort((a, b) => b.created - a.created);
        res.json(files);
      } catch (err) {
        res.status(500).json({ error: 'Failed to read thumbnails' });
      }
    });

    expressApp.get('/api/thumbnails/:filename', (req, res) => {
      const filename = req.params.filename;
      // Validate filename to prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      const filePath = path.join(thumbnailsFolder, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Thumbnail not found' });
      }
      res.sendFile(filePath);
    });

    expressApp.delete('/api/thumbnails/:filename', (req, res) => {
      const filename = req.params.filename;
      // Validate filename to prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      const filePath = path.join(thumbnailsFolder, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Thumbnail not found' });
      }
      try {
        fs.unlinkSync(filePath);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete thumbnail' });
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
    } else if (fs.existsSync(clientPath)) {
      // Production mode: serve static build with no-cache headers
      console.log('[SERVER] Production mode: serving static files from dist/');
      expressApp.use(express.static(clientPath, {
        setHeaders: (res, filePath) => {
          res.setHeader('Cache-Control', 'no-store, must-revalidate');
        }
      }));

      // Fallback to serve index.html for client-side routing (must be after API routes)
      expressApp.get('*', (req, res) => {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.sendFile(path.join(clientPath, 'index.html'));
      });
    } else {
      // If no build exists and not in dev mode, serve error page
      expressApp.get('/', (req, res) => {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.send('<html><body><h1>Client build not found</h1><p>Run: npm run build</p></body></html>');
      });
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
          liveBackgroundImage: data.settings.liveBackgroundImage ?? currentState.settings.liveBackgroundImage
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
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  // In development, load from Vite dev server (5173), in production load from Express (5555)
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL('http://localhost:5555');
  }
}

app.whenReady().then(async () => {
  await startServer(5555);
  createWindow();
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