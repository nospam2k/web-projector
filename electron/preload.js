const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Server management
  startServer: (port) => ipcRenderer.invoke('start-server', port),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  broadcastUpdate: (data) => ipcRenderer.send('broadcast-update', data),

  // Songs
  getAllSongs: () => ipcRenderer.invoke('db:getAllSongs'),
  getSongById: (id) => ipcRenderer.invoke('db:getSongById', id),
  createSong: (song) => ipcRenderer.invoke('db:createSong', song),
  updateSong: (id, updates) => ipcRenderer.invoke('db:updateSong', id, updates),
  deleteSong: (id) => ipcRenderer.invoke('db:deleteSong', id),

  // Slides
  getAllSlides: () => ipcRenderer.invoke('db:getAllSlides'),
  getSlideById: (id) => ipcRenderer.invoke('db:getSlideById', id),
  createSlide: (slide) => ipcRenderer.invoke('db:createSlide', slide),
  updateSlide: (id, updates) => ipcRenderer.invoke('db:updateSlide', id, updates),
  deleteSlide: (id) => ipcRenderer.invoke('db:deleteSlide', id),

  // Playlists
  getPlaylist: (type) => ipcRenderer.invoke('db:getPlaylist', type),
  savePlaylist: (type, data) => ipcRenderer.invoke('db:savePlaylist', type, data),
});
