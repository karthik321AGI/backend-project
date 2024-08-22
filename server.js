const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let rooms = new Map();

function logState() {
  console.log(`Active rooms: ${rooms.size}`);
  rooms.forEach((room, roomId) => {
    console.log(`Room ${roomId}: ${room.size} participants`);
  });
}

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  logState();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);

      switch (data.type) {
        case 'create_room':
          const roomId = uuidv4();
          rooms.set(roomId, new Set([ws]));
          ws.roomId = roomId;
          ws.send(JSON.stringify({ type: 'room_created', roomId }));
          break;

        case 'join_room':
          const room = rooms.get(data.roomId);
          if (room) {
            room.add(ws);
            ws.roomId = data.roomId;
            ws.send(JSON.stringify({ type: 'room_joined', roomId: data.roomId }));
            room.forEach(participant => {
              if (participant !== ws) {
                participant.send(JSON.stringify({ type: 'new_participant', id: ws.id }));
              }
            });
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          }
          break;

        case 'offer':
        case 'answer':
        case 'ice_candidate':
          const targetRoom = rooms.get(ws.roomId);
          if (targetRoom) {
            targetRoom.forEach(participant => {
              if (participant !== ws) {
                participant.send(JSON.stringify({ ...data, senderId: ws.id }));
              }
            });
          }
          break;

        case 'leave_room':
          handleParticipantLeave(ws);
          break;
      }
      logState();
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    handleParticipantLeave(ws);
    logState();
  });

  // Assign a unique ID to each connection
  ws.id = uuidv4();
});

function handleParticipantLeave(ws) {
  const room = rooms.get(ws.roomId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) {
      rooms.delete(ws.roomId);
    } else {
      room.forEach(participant => {
        participant.send(JSON.stringify({ type: 'participant_left', id: ws.id }));
      });
    }
  }
  delete ws.roomId;
}

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on port ${server.address().port}`);
});