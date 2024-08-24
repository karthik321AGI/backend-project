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
    room.participants.forEach(participant => {
      if (participant.ws !== excludeClient && participant.ws.readyState === WebSocket.OPEN) {
        sendTo(participant.ws, message);
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
          name: data.roomName,
          hostName: data.hostName,
          participants: [{ id: ws.id, name: data.hostName, ws: ws }]
        });
        ws.roomId = roomId;
        sendTo(ws, { type: 'room_created', roomId, participants: 1 });
        console.log(`Room created: ${roomId}`);
        break;

      case 'join_room':
        const room = rooms.get(data.roomId);
        if (room) {
          room.participants.push({ id: ws.id, name: data.name, ws: ws });
          ws.roomId = data.roomId;
          sendTo(ws, {
            type: 'room_joined',
            roomId: data.roomId,
            participants: room.participants.map(p => ({ id: p.id, name: p.name }))
          });
          broadcastToRoom(data.roomId, {
            type: 'new_participant',
            id: ws.id,
            name: data.name
          }, ws);
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
          const targetParticipant = targetRoom.participants.find(p => p.id === data.targetId);
          if (targetParticipant) {
            sendTo(targetParticipant.ws, { ...data, senderId: ws.id });
            console.log(`Forwarded ${data.type} from ${ws.id} to ${data.targetId}`);
          }
        }
        break;

      case 'leave_room':
        handleLeaveRoom(ws);
        break;

      case 'close_room':
        const roomToClose = rooms.get(ws.roomId);
        if (roomToClose && roomToClose.participants[0].id === ws.id) {
          broadcastToRoom(ws.roomId, { type: 'room_closed' });
          rooms.delete(ws.roomId);
          console.log(`Room ${ws.roomId} closed by host`);
        }
        break;

      case 'get_room_list':
        const roomList = Array.from(rooms.values()).map(room => ({
          id: room.id,
          name: room.name,
          hostName: room.hostName,
          participants: room.participants.length
        }));
        sendTo(ws, { type: 'room_list', rooms: roomList });
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
    room.participants = room.participants.filter(p => p.id !== ws.id);
    console.log(`User ${ws.id} left room ${ws.roomId}`);
    if (room.participants.length === 0) {
      rooms.delete(ws.roomId);
      console.log(`Room ${ws.roomId} deleted`);
    } else {
      broadcastToRoom(ws.roomId, {
        type: 'participant_left',
        id: ws.id,
        participants: room.participants.map(p => ({ id: p.id, name: p.name }))
      });
      console.log(`Notified remaining participants in room ${ws.roomId}`);
    }
  }
  delete ws.roomId;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});