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

function broadcastToAll(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      sendTo(client, message);
    }
  });
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

function updateRoomsList() {
  broadcastToAll({
    type: 'rooms_list',
    rooms: Array.from(rooms.values()).map(room => ({
      id: room.id,
      title: room.title,
      hostName: room.hostName,
      participants: room.participants.map(p => ({ id: p.id, name: p.name }))
    }))
  });
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
        updateRoomsList();
        break;

      case 'create_room':
        const roomId = uuidv4();
        const hostParticipant = {
          id: ws.id,
          name: data.hostName,
          ws: ws
        };
        rooms.set(roomId, {
          id: roomId,
          title: data.title,
          hostName: data.hostName,
          hostId: ws.id,
          participants: [hostParticipant] // Add the host as the first participant
        });
        ws.roomId = roomId;
        sendTo(ws, {
          type: 'room_created',
          roomId,
          title: data.title,
          participants: [{ id: hostParticipant.id, name: hostParticipant.name }]
        });
        console.log(`Room created: ${roomId}`);
        updateRoomsList();
        break;

      case 'join_room':
        const room = rooms.get(data.roomId);
        if (room) {
          // Check if the user is already in the room (e.g., the host)
          const existingParticipant = room.participants.find(p => p.id === ws.id);
          if (!existingParticipant) {
            const participant = {
              id: ws.id,
              name: data.userName,
              ws: ws
            };
            room.participants.push(participant);
            ws.roomId = data.roomId;
          }
          sendTo(ws, {
            type: 'room_joined',
            roomId: data.roomId,
            title: room.title,
            participants: room.participants.map(p => ({ id: p.id, name: p.name }))
          });
          if (!existingParticipant) {
            broadcastToRoom(data.roomId, {
              type: 'participant_joined',
              participantId: ws.id,
              userName: data.userName,
              participants: room.participants.map(p => ({ id: p.id, name: p.name }))
            }, ws);
          }
          console.log(`User ${ws.id} joined room ${data.roomId}`);
          updateRoomsList();
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
        participantId: ws.id,
        participants: room.participants.map(p => ({ id: p.id, name: p.name }))
      });
      console.log(`Notified remaining participants in room ${ws.roomId}`);
    }
    updateRoomsList();
  }
  delete ws.roomId;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});