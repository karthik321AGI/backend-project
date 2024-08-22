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
          room.forEach(client => {
            if (client !== ws) {
              sendTo(client, { type: 'new_participant', id: ws.id });
            }
          });
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
  const room = rooms.get(ws.roomId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) {
      rooms.delete(ws.roomId);
      console.log(`Room ${ws.roomId} deleted`);
    } else {
      room.forEach(client => {
        sendTo(client, { type: 'participant_left', id: ws.id, participants: room.size });
      });
    }
  }
  delete ws.roomId;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});