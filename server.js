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
    room.participants.forEach(client => {
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
        rooms.set(roomId, {
          id: roomId,
          title: data.title,
          host: data.host,
          participants: new Set([ws])
        });
        ws.roomId = roomId;
        sendTo(ws, { type: 'room_created', roomId, title: data.title });
        console.log(`Room created: ${roomId}`);
        break;

      case 'get_rooms':
        const roomsList = Array.from(rooms.values()).map(room => ({
          id: room.id,
          title: room.title,
          host: room.host,
          participants: room.participants.size
        }));
        sendTo(ws, { type: 'rooms_list', rooms: roomsList });
        break;

      case 'join_room':
        const room = rooms.get(data.roomId);
        if (room) {
          room.participants.add(ws);
          ws.roomId = data.roomId;
          ws.username = data.username;
          sendTo(ws, { type: 'room_joined', roomId: data.roomId, title: room.title });
          broadcastToRoom(data.roomId, {
            type: 'new_participant',
            id: ws.id,
            username: data.username
          }, ws);
          console.log(`User ${ws.id} (${data.username}) joined room ${data.roomId}`);
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
          targetRoom.participants.forEach(client => {
            if (client.id === data.targetId) {
              sendTo(client, { ...data, senderId: ws.id, senderUsername: ws.username });
              console.log(`Forwarded ${data.type} from ${ws.id} to ${data.targetId}`);
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
    room.participants.delete(ws);
    console.log(`User ${ws.id} left room ${ws.roomId}`);
    if (room.participants.size === 0) {
      rooms.delete(ws.roomId);
      console.log(`Room ${ws.roomId} deleted`);
    } else {
      broadcastToRoom(ws.roomId, {
        type: 'participant_left',
        id: ws.id,
        username: ws.username
      });
      console.log(`Notified remaining participants in room ${ws.roomId}`);
    }
  }
  delete ws.roomId;
  delete ws.username;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});