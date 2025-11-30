const WebSocket = require('ws');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`P3D Multiplayer Server running on port ${PORT}`);
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients with their info
const clients = new Map();

wss.on('connection', (ws) => {
  const clientId = generateId();
  console.log(`Client connected: ${clientId}`);
  
  clients.set(clientId, {
    ws: ws,
    callsign: null,
    aircraft: null,
    lastUpdate: Date.now()
  });

  // Send client their ID
  ws.send(JSON.stringify({
    type: 'connected',
    clientId: clientId,
    totalClients: clients.size
  }));

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(clientId, data);
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    const client = clients.get(clientId);
    console.log(`Client disconnected: ${clientId} (${client?.callsign || 'Unknown'})`);
    
    // Notify others of disconnect
    broadcast({
      type: 'player_left',
      clientId: clientId,
      callsign: client?.callsign
    }, clientId);
    
    clients.delete(clientId);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${clientId}:`, error);
  });
});

function handleMessage(senderId, data) {
  const client = clients.get(senderId);
  
  switch(data.type) {
    case 'join':
      client.callsign = data.callsign;
      client.aircraft = data.aircraft;
      console.log(`${data.callsign} joined with ${data.aircraft}`);
      
      // Send list of existing players to new client
      const playerList = [];
      clients.forEach((c, id) => {
        if (id !== senderId && c.callsign) {
          playerList.push({
            clientId: id,
            callsign: c.callsign,
            aircraft: c.aircraft
          });
        }
      });
      
      client.ws.send(JSON.stringify({
        type: 'player_list',
        players: playerList
      }));
      
      // Notify others of new player
      broadcast({
        type: 'player_joined',
        clientId: senderId,
        callsign: data.callsign,
        aircraft: data.aircraft
      }, senderId);
      break;
      
    case 'position':
      client.lastUpdate = Date.now();
      // Relay position to all other clients
      broadcast({
        type: 'position',
        clientId: senderId,
        callsign: client.callsign,
        ...data.position
      }, senderId);
      break;
      
    case 'chat':
      console.log(`[CHAT] ${client.callsign}: ${data.message}`);
      broadcast({
        type: 'chat',
        callsign: client.callsign,
        message: data.message,
        timestamp: Date.now()
      });
      break;
  }
}

function broadcast(message, excludeId = null) {
  const messageStr = JSON.stringify(message);
  clients.forEach((client, id) => {
    if (id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
    }
  });
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Heartbeat to detect stale connections
setInterval(() => {
  const now = Date.now();
  clients.forEach((client, id) => {
    if (now - client.lastUpdate > 30000) { // 30 seconds timeout
      console.log(`Removing stale client: ${id}`);
      client.ws.terminate();
      clients.delete(id);
    }
  });
}, 10000);

// Health check endpoint for Render
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    connectedClients: clients.size,
    uptime: process.uptime()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});