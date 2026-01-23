#!/usr/bin/env node

const WebSocket = require('ws');

console.log('Testing WebSocket connection to ws://localhost:5555/ws');

const ws = new WebSocket('ws://localhost:5555/ws');

ws.on('open', () => {
  console.log('✓ Connected successfully');
});

ws.on('message', (data) => {
  console.log('✓ Received message:', data.toString().substring(0, 200));
  try {
    const parsed = JSON.parse(data);
    console.log('✓ Message type:', parsed.type);
    if (parsed.type === 'fullState') {
      console.log('✓ Full state received:', {
        songs: parsed.data.songs?.length || 0,
        slides: parsed.data.slides?.length || 0,
        songItems: parsed.data.songItems?.length || 0,
        slideItems: parsed.data.slideItems?.length || 0
      });
    }
  } catch (err) {
    console.error('✗ Error parsing message:', err.message);
  }
});

ws.on('close', (code, reason) => {
  console.log('✗ Connection closed:', code, reason.toString());
  process.exit(code === 1000 ? 0 : 1);
});

ws.on('error', (error) => {
  console.error('✗ WebSocket error:', error.message);
});

// Keep alive for 5 seconds
setTimeout(() => {
  console.log('Test timeout - closing connection');
  ws.close(1000, 'Test complete');
}, 5000);
