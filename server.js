const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

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
        ws.roomId = roomId;
        sendTo(ws, { type: 'room_created', roomId, participants: 1 });
        console.log(`Room created: ${roomId}`);
        break;

      case 'join_room':
        const room = rooms.get(data.roomId);
        if (room) {
          room.add(ws);
          ws.roomId = data.roomId;
          sendTo(ws, { type: 'room_joined', roomId: data.roomId, participants: room.size });
          broadcastToRoom(data.roomId, { type: 'new_participant', id: ws.id, participants: room.size }, ws);
          console.log(`User ${ws.id} joined room ${data.roomId}`);
        } else {
          sendTo(ws, { type: 'error', message: 'Room not found' });
          console.log(`Failed to join room: ${data.roomId} - Room not found`);
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
              console.log(`Forwarded ${data.type} from ${ws.id} to ${data.targetId}`);
            }
          });
        }
        break;

      case 'ice_restart':
        const restartRoom = rooms.get(ws.roomId);
        if (restartRoom) {
          restartRoom.forEach(client => {
            if (client !== ws && client.id === data.targetId) {
              sendTo(client, { type: 'ice_restart', senderId: ws.id });
              console.log(`ICE restart request sent from ${ws.id} to ${data.targetId}`);
            }
          });
        }
        break;

      case 'start_hole_punch':
        const holePunchRoom = rooms.get(ws.roomId);
        if (holePunchRoom) {
          holePunchRoom.forEach(client => {
            if (client !== ws) {
              sendTo(client, { type: 'hole_punch_start', targetId: ws.id });
              console.log(`Hole punch start request sent from ${ws.id} to ${client.id}`);
            }
          });
        }
        break;

      case 'relay_message':
        const relayRoom = rooms.get(ws.roomId);
        if (relayRoom) {
          relayRoom.forEach(client => {
            if (client.id === data.targetId) {
              sendTo(client, { type: 'relayed_message', message: data.message, senderId: ws.id });
              console.log(`Relayed message from ${ws.id} to ${data.targetId}`);
            }
          });
        }
        break;

      case 'leave_room':
        handleLeaveRoom(ws);
        break;

      default:
        console.log(`Unhandled message type: ${data.type}`);
    }
  });

  ws.on('close', () => {
    console.log(`Client ${ws.id} disconnected`);
    handleLeaveRoom(ws);
  });
});

function handleLeaveRoom(ws) {
  const room = rooms.get(ws.roomId);
  if (room) {
    room.delete(ws);
    console.log(`User ${ws.id} left room ${ws.roomId}`);
    if (room.size === 0) {
      rooms.delete(ws.roomId);
      console.log(`Room ${ws.roomId} deleted`);
    } else {
      broadcastToRoom(ws.roomId, { type: 'participant_left', id: ws.id, participants: room.size });
      console.log(`Notified remaining participants in room ${ws.roomId}`);
    }
  }
  delete ws.roomId;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});