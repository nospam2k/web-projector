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
  slideItems: []
};

// Load initial state
function loadInitialState() {
  const songsStmt = db.prepare('SELECT * FROM songs ORDER BY title');
  const slidesStmt = db.prepare('SELECT * FROM slides ORDER BY title');
  const songPlaylistStmt = db.prepare('SELECT data FROM playlists WHERE type = ?');
  const slidePlaylistStmt = db.prepare('SELECT data FROM playlists WHERE type = ?');

  currentState.songs = songsStmt.all();
  currentState.slides = slidesStmt.all();

  const songRow = songPlaylistStmt.get('songs');
  const slideRow = slidePlaylistStmt.get('slides');

  currentState.songItems = songRow ? JSON.parse(songRow.data) : [];
  currentState.slideItems = slideRow ? JSON.parse(slideRow.data) : [];
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
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
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

    if (fs.existsSync(clientPath)) {
      // Serve static build with no-cache headers
      expressApp.use(express.static(clientPath, {
        setHeaders: (res, filePath) => {
          res.setHeader('Cache-Control', 'no-store, must-revalidate');
        }
      }));

      // Fallback to serve index.html for client-side routing (must be after API routes)
      expressApp.get('/', (req, res) => {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.sendFile(path.join(clientPath, 'index.html'));
      });
    } else if (createProxyMiddleware && isDev) {
      // In development, proxy requests to Vite dev server
      expressApp.use('/', createProxyMiddleware({
        target: 'http://localhost:5173',
        changeOrigin: true,
        ws: false,  // Manual WebSocket handling below
        onProxyRes: (proxyRes, req, res) => {
          proxyRes.headers['cache-control'] = 'no-store, must-revalidate';
        }
      }));
    } else {
      // If no build exists and no proxy is available, serve a simple HTML page
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
      const stmt = db.prepare('INSERT OR REPLACE INTO playlists (type, data) VALUES (?, ?)');
      stmt.run(data.playlistType, JSON.stringify(data.items));
      
      // Update state
      if (data.playlistType === 'songs') {
        currentState.songItems = data.items;
      } else {
        currentState.slideItems = data.items;
      }
      
      // Broadcast to all other clients
      broadcastToAll({
        type: data.playlistType === 'songs' ? 'songItems' : 'slideItems',
        data: data.items
      });
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

  // Always load from localhost:5555
  mainWindow.loadURL('http://localhost:5555');

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.webContents.openDevTools();
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