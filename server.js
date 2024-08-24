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
      case 'get_rooms':
        const roomsList = Array.from(rooms.values())
          .filter(room => !room.inactive)
          .map(room => ({
            id: room.id,
            title: room.title,
            host: room.host.username,
            participants: room.participants.size
          }));
        sendTo(ws, { type: 'rooms_list', rooms: roomsList });
        console.log('Sending rooms list:', roomsList);
        break;

      case 'create_room':
        const roomId = uuidv4();
        const newRoom = {
          id: roomId,
          title: data.title,
          host: { id: ws.id, username: data.username },
          participants: new Map([[ws.id, { ws, username: data.username }]]),
          inactive: false
        };
        rooms.set(roomId, newRoom);
        ws.roomId = roomId;
        sendTo(ws, {
          type: 'room_created',
          roomId,
          roomTitle: data.title,
          participants: Array.from(newRoom.participants.values()).map(p => ({ id: p.ws.id, username: p.username }))
        });
        console.log(`Room created: ${roomId}`);
        break;

      case 'join_room':
        const room = rooms.get(data.roomId);
        if (room) {
          room.participants.set(ws.id, { ws, username: data.username });
          ws.roomId = data.roomId;
          room.inactive = false; // Reactivate the room if it was inactive
          sendTo(ws, {
            type: 'room_joined',
            roomId: data.roomId,
            roomTitle: room.title,
            participants: Array.from(room.participants.values()).map(p => ({ id: p.ws.id, username: p.username }))
          });
          broadcastToRoom(data.roomId, {
            type: 'new_participant',
            id: ws.id,
            username: data.username,
            participants: Array.from(room.participants.values()).map(p => ({ id: p.ws.id, username: p.username }))
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
          const targetParticipant = targetRoom.participants.get(data.targetId);
          if (targetParticipant) {
            sendTo(targetParticipant.ws, { ...data, senderId: ws.id });
            console.log(`Forwarded ${data.type} from ${ws.id} to ${data.targetId}`);
          }
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
    room.participants.delete(ws.id);
    console.log(`User ${ws.id} left room ${ws.roomId}`);
    if (room.participants.size === 0) {
      // Instead of deleting, mark the room as inactive
      room.inactive = true;
      console.log(`Room ${ws.roomId} marked as inactive`);
      // Optionally, set a timeout to delete the room after a period of inactivity
      setTimeout(() => {
        if (room.inactive) {
          rooms.delete(ws.roomId);
          console.log(`Room ${ws.roomId} deleted due to inactivity`);
        }
      }, 5 * 60 * 1000); // 5 minutes
    } else {
      if (room.host.id === ws.id) {
        const newHost = room.participants.values().next().value;
        room.host = { id: newHost.ws.id, username: newHost.username };
      }
      broadcastToRoom(ws.roomId, {
        type: 'participant_left',
        id: ws.id,
        participants: Array.from(room.participants.values()).map(p => ({ id: p.ws.id, username: p.username })),
        newHost: room.host
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