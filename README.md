# Web Projector

A cross-platform Electron app for displaying song lyrics and slides with live presentation features.

## Features

- **Song Management**: Create, edit, and organize songs with lyrics and chords
- **Slide Management**: Create and manage custom presentation slides
- **Playlist System**: Organize songs and slides into playlists
- **Live Display**: Real-time synchronization across multiple devices
- **WebSocket Sync**: All connected clients stay in sync automatically
- **Customizable Backgrounds**: Upload custom background images
- **Font Support**: Load and use custom fonts
- **Persistent Settings**: Window position, size, and preferences are saved
- **Portable Mode**: Data stored next to the executable for easy backup

## Development

### Prerequisites

- Node.js 20 or higher
- npm

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run electron:dev

# Build for production
npm run build
npx electron-builder --win --x64
```

## Building for Windows

### Automated Build (Recommended)

Push to GitHub and the Windows build will be created automatically via GitHub Actions. Download the built executable from the "Actions" tab.

### Manual Build on Windows

1. Install Node.js on Windows
2. Clone this repository
3. Run:
   ```bash
   npm install
   npm run build
   npx electron-builder --win --x64
   ```

## Architecture

- **Frontend**: React + Vite + TailwindCSS
- **Backend**: Express server (runs inside Electron)
- **Database**: SQLite (better-sqlite3)
- **Real-time Communication**: WebSocket (ws library)
- **Desktop Framework**: Electron

## Data Storage

In production, data is stored in a `data` folder next to the executable:
- `data/web-projector.db` - SQLite database
- `data/images/` - Uploaded background images
- `data/fonts/` - Custom font files

## License

Copyright © 2026 David Ford
