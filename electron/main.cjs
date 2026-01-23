const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

// Try to require optional dependencies
let express, WebSocketServer, http, createProxyMiddleware;
try {
  express = require('express');
  const ws = require('ws');
  WebSocketServer = ws.WebSocketServer;
  http = require('http');
  const { createProxyMiddleware: proxyMiddleware } = require('http-proxy-middleware');
  createProxyMiddleware = proxyMiddleware;
  console.log('WebSocket dependencies loaded successfully');
} catch (error) {
  console.error('Failed to load WebSocket dependencies:', error.message);
  console.error('Please run: npm install express ws http-proxy-middleware');
}

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

ipcMain.handle('start-server', async (event, port) => {
  try {
    // Check if dependencies are available
    if (!express || !WebSocketServer || !http) {
      return { 
        success: false, 
        error: 'WebSocket dependencies not installed. Please run: npm install express ws' 
      };
    }

    if (httpServer) {
      return { success: true, message: 'Server already running' };
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
    return { success: true, port };

  } catch (error) {
    console.error('Error starting server:', error);
    return { success: false, error: error.message };
  }
});

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

ipcMain.handle('stop-server', async () => {
  try {
    if (wss) {
      wss.clients.forEach(client => client.close());
      wss.close();
      wss = null;
    }

    if (httpServer) {
      await new Promise((resolve) => {
        httpServer.close(resolve);
      });
      httpServer = null;
    }

    expressApp = null;
    console.log('Server stopped');
    return { success: true };

  } catch (error) {
    console.error('Error stopping server:', error);
    return { success: false, error: error.message };
  }
});

// Broadcast updates from Electron app
ipcMain.on('broadcast-update', (event, data) => {
  // Update current state
  if (data.type === 'songItems') currentState.songItems = data.data;
  if (data.type === 'slideItems') currentState.slideItems = data.data;
  
  // Reload songs/slides if they changed
  if (data.type === 'songsChanged') {
    const stmt = db.prepare('SELECT * FROM songs ORDER BY title');
    currentState.songs = stmt.all();
    broadcastToAll({ type: 'songs', data: currentState.songs });
    return;
  }
  
  if (data.type === 'slidesChanged') {
    const stmt = db.prepare('SELECT * FROM slides ORDER BY title');
    currentState.slides = stmt.all();
    broadcastToAll({ type: 'slides', data: currentState.slides });
    return;
  }
  
  broadcastToAll(data);
});

// ============================================================================
// IPC HANDLERS - SONGS
// ============================================================================

ipcMain.handle('db:getAllSongs', () => {
  const stmt = db.prepare('SELECT * FROM songs ORDER BY title');
  const result = stmt.all();
  currentState.songs = result;
  return result;
});

ipcMain.handle('db:getSongById', (event, id) => {
  const stmt = db.prepare('SELECT * FROM songs WHERE id = ?');
  return stmt.get(id);
});

ipcMain.handle('db:createSong', (event, song) => {
  const stmt = db.prepare('INSERT INTO songs (title, lyrics, chords) VALUES (?, ?, ?)');
  const info = stmt.run(song.title, song.lyrics || '', song.chords || '');
  const newSong = { id: info.lastInsertRowid, ...song };
  
  // Update state and broadcast
  currentState.songs = db.prepare('SELECT * FROM songs ORDER BY title').all();
  broadcastToAll({ type: 'songs', data: currentState.songs });
  
  return newSong;
});

ipcMain.handle('db:updateSong', (event, id, updates) => {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  const stmt = db.prepare(`UPDATE songs SET ${fields} WHERE id = ?`);
  stmt.run(...values, id);
  
  const getStmt = db.prepare('SELECT * FROM songs WHERE id = ?');
  const result = getStmt.get(id);
  
  // Update state and broadcast
  currentState.songs = db.prepare('SELECT * FROM songs ORDER BY title').all();
  broadcastToAll({ type: 'songs', data: currentState.songs });
  
  return result;
});

ipcMain.handle('db:deleteSong', (event, id) => {
  const stmt = db.prepare('DELETE FROM songs WHERE id = ?');
  stmt.run(id);
  
  // Update state and broadcast
  currentState.songs = db.prepare('SELECT * FROM songs ORDER BY title').all();
  broadcastToAll({ type: 'songs', data: currentState.songs });
  
  return true;
});

// ============================================================================
// IPC HANDLERS - PLAYLIST
// ============================================================================

ipcMain.handle('db:getPlaylist', (event, type) => {
  const stmt = db.prepare('SELECT data FROM playlists WHERE type = ?');
  const row = stmt.get(type);
  const result = row ? JSON.parse(row.data) : [];
  
  if (type === 'songs') currentState.songItems = result;
  else currentState.slideItems = result;
  
  return result;
});

ipcMain.handle('db:savePlaylist', (event, type, data) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO playlists (type, data) VALUES (?, ?)');
  stmt.run(type, JSON.stringify(data));
  
  // Update state
  if (type === 'songs') currentState.songItems = data;
  else currentState.slideItems = data;
  
  // Don't broadcast here - it's handled by the broadcast-update in App.jsx
  
  return true;
});

// ============================================================================
// IPC HANDLERS - SLIDES
// ============================================================================

ipcMain.handle('db:getAllSlides', () => {
  const stmt = db.prepare('SELECT * FROM slides ORDER BY title');
  const result = stmt.all();
  currentState.slides = result;
  return result;
});

ipcMain.handle('db:getSlideById', (event, id) => {
  const stmt = db.prepare('SELECT * FROM slides WHERE id = ?');
  return stmt.get(id);
});

ipcMain.handle('db:createSlide', (event, slide) => {
  const stmt = db.prepare('INSERT INTO slides (title, content) VALUES (?, ?)');
  const info = stmt.run(slide.title, slide.content || '');
  const newSlide = { id: info.lastInsertRowid, ...slide };
  
  // Update state and broadcast
  currentState.slides = db.prepare('SELECT * FROM slides ORDER BY title').all();
  broadcastToAll({ type: 'slides', data: currentState.slides });
  
  return newSlide;
});

ipcMain.handle('db:updateSlide', (event, id, updates) => {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  const stmt = db.prepare(`UPDATE slides SET ${fields} WHERE id = ?`);
  stmt.run(...values, id);
  
  const getStmt = db.prepare('SELECT * FROM slides WHERE id = ?');
  const result = getStmt.get(id);
  
  // Update state and broadcast
  currentState.slides = db.prepare('SELECT * FROM slides ORDER BY title').all();
  broadcastToAll({ type: 'slides', data: currentState.slides });
  
  return result;
});

ipcMain.handle('db:deleteSlide', (event, id) => {
  const stmt = db.prepare('DELETE FROM slides WHERE id = ?');
  stmt.run(id);
  
  // Update state and broadcast
  currentState.slides = db.prepare('SELECT * FROM slides ORDER BY title').all();
  broadcastToAll({ type: 'slides', data: currentState.slides });
  
  return true;
});

// ============================================================================
// ELECTRON WINDOW SETUP
// ============================================================================

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Vite dev server or production build
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173'); // Vite default port
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
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
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Close database and server when app quits
app.on('before-quit', () => {
  if (wss) {
    wss.clients.forEach(client => client.close());
    wss.close();
  }
  if (httpServer) {
    httpServer.close();
  }
  db.close();
});