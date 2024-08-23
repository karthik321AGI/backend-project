const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const clientToRoom = new Map();

function sendTo(ws, message) {
  ws.send(JSON.stringify(message));
}

function broadcastToRoom(roomId, message, excludeClient = null) {
  const room = rooms.get(roomId);
  if (room) {
    room.forEach(client => {
      if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
        sendTo(client, message);
      }
    });
  }
}

wss.on('connection', (ws) => {
  console.log('New client connected');
  ws.id = uuidv4();

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.error("Invalid JSON");
      data = {};
    }

    console.log('Received message:', data);

    switch (data.type) {
      case 'create_room':
        const roomId = uuidv4();
        rooms.set(roomId, new Set([ws]));
        clientToRoom.set(ws, roomId);
        ws.roomId = roomId;
        sendTo(ws, { type: 'room_created', roomId, participants: 1 });
        console.log(`Room created: ${roomId}`);
        break;

      case 'join_room':
        const room = rooms.get(data.roomId);
        if (room) {
          room.add(ws);
          clientToRoom.set(ws, data.roomId);
          ws.roomId = data.roomId;
          sendTo(ws, { type: 'room_joined', roomId: data.roomId, participants: room.size });
          broadcastToRoom(data.roomId, { type: 'new_participant', id: ws.id, participants: room.size }, ws);
          console.log(`User ${ws.id} joined room ${data.roomId}`);
        } else {
          sendTo(ws, { type: 'error', message: 'Room not found' });
        }
        break;

      case 'offer':
      case 'answer':
      case 'ice_candidate':
        const targetRoom = rooms.get(ws.roomId);
        if (targetRoom) {
          targetRoom.forEach(client => {
            if (client !== ws && client.id === data.targetId) {
              sendTo(client, { ...data, senderId: ws.id });
            }
          });
        }
        break;

      case 'relay_request':
        handleRelayRequest(ws, data);
        break;

      case 'leave_room':
        handleLeaveRoom(ws);
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    handleLeaveRoom(ws);
  });
});

function handleLeaveRoom(ws) {
  const roomId = clientToRoom.get(ws);
  if (roomId) {
    const room = rooms.get(roomId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} deleted`);
      } else {
        broadcastToRoom(roomId, { type: 'participant_left', id: ws.id, participants: room.size });
      }
    }
    clientToRoom.delete(ws);
  }
}

function handleRelayRequest(ws, data) {
  const roomId = clientToRoom.get(ws);
  if (roomId) {
    const room = rooms.get(roomId);
    if (room) {
      const targetClient = Array.from(room).find(client => client.id === data.targetId);
      if (targetClient) {
        sendTo(targetClient, {
          type: 'relayed_data',
          senderId: ws.id,
          data: data.data
        });
      }
    }
  }
}

// Implement periodic connection checks
setInterval(() => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.ping(() => { });
    }
  });
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});