const { app, BrowserWindow } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const express = require('express');
const ws = require('ws');
const WebSocketServer = ws.WebSocketServer;
const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Initialize database - point to your existing database file
const dbPath = path.join(__dirname, '../web-projector.db');
const db = new Database(dbPath);

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

    // Serve the React app build files or proxy to Vite in development
    const clientPath = path.join(__dirname, '../dist');
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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
      // In development, proxy requests to Vite dev server so external browsers see the live app
      expressApp.use('/', createProxyMiddleware({
        target: 'http://localhost:5173',
        changeOrigin: true,
        ws: true,
        onProxyRes: (proxyRes, req, res) => {
          // Override cache headers from proxied server
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

    // Create WebSocket server
    wss = new WebSocketServer({ server: httpServer });

    // Handle WebSocket connections
    wss.on('connection', (ws) => {
      console.log('Client connected');

      // Send full state to newly connected client
      ws.send(JSON.stringify({
        type: 'fullState',
        data: currentState
      }));

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

      ws.on('close', () => {
        console.log('Client disconnected');
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