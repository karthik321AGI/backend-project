const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const rooms = [];
const clients = new Map();

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  clients.set(ws, { id: clientId });
  ws.id = clientId;

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    console.log('Received message:', data);

    switch (data.type) {
      case 'get_rooms':
        ws.send(JSON.stringify({ type: 'rooms_list', rooms }));
        break;

      case 'create_room':
        const newRoom = {
          id: uuidv4(),
          title: data.title,
          hostName: data.hostName,
          participants: []
        };
        rooms.push(newRoom);

        // Immediately add the creator to the room
        const creatorParticipant = {
          id: ws.id,
          name: data.hostName
        };
        newRoom.participants.push(creatorParticipant);

        // Send the updated room list to all clients
        broadcastRoomsList();

        // Send a 'room_created' event to the creator
        ws.send(JSON.stringify({
          type: 'room_created',
          room: newRoom
        }));
        break;

      case 'join_room':
        const roomToJoin = rooms.find(room => room.id === data.roomId);
        if (roomToJoin) {
          const participant = {
            id: ws.id,
            name: data.userName
          };

          // Check if the participant is already in the room
          const existingParticipant = roomToJoin.participants.find(p => p.id === ws.id);
          if (!existingParticipant) {
            roomToJoin.participants.push(participant);
          }

          ws.roomId = data.roomId;

          // Notify all clients in the room about the new participant
          broadcastToRoom(roomToJoin.id, {
            type: 'participant_joined',
            participant: participant
          });

          // Send the updated room information to the joining participant
          ws.send(JSON.stringify({
            type: 'room_joined',
            room: roomToJoin
          }));

          // Update the room list for all clients
          broadcastRoomsList();
        }
        break;

      case 'leave_room':
        const roomToLeave = rooms.find(room => room.id === data.roomId);
        if (roomToLeave) {
          roomToLeave.participants = roomToLeave.participants.filter(p => p.id !== ws.id);
          delete ws.roomId;

          broadcastToRoom(roomToLeave.id, {
            type: 'participant_left',
            participantId: ws.id,
            participants: roomToLeave.participants
          });

          if (roomToLeave.participants.length === 0) {
            const index = rooms.findIndex(room => room.id === roomToLeave.id);
            if (index !== -1) {
              rooms.splice(index, 1);
            }
          }

          broadcastRoomsList();
        }
        break;

      case 'offer':
      case 'answer':
      case 'ice_candidate':
        const targetClient = [...clients.keys()].find(client => client.id === data.targetId);
        if (targetClient) {
          targetClient.send(JSON.stringify({
            ...data,
            senderId: ws.id
          }));
        }
        break;

      case 'active_speaker':
        broadcastToRoom(ws.roomId, {
          type: 'active_speaker',
          participantId: data.participantId,
          isActive: data.isActive
        });
        break;
    }
  });

  ws.on('close', () => {
    const roomToLeave = rooms.find(room => room.participants.some(p => p.id === ws.id));
    if (roomToLeave) {
      roomToLeave.participants = roomToLeave.participants.filter(p => p.id !== ws.id);

      broadcastToRoom(roomToLeave.id, {
        type: 'participant_left',
        participantId: ws.id,
        participants: roomToLeave.participants
      });

      if (roomToLeave.participants.length === 0) {
        const index = rooms.findIndex(room => room.id === roomToLeave.id);
        if (index !== -1) {
          rooms.splice(index, 1);
        }
      }

      broadcastRoomsList();
    }

    clients.delete(ws);
  });
});

function broadcastRoomsList() {
  const roomsList = rooms.map(room => ({
    id: room.id,
    title: room.title,
    hostName: room.hostName,
    participants: room.participants.map(p => ({ id: p.id, name: p.name }))
  }));

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'rooms_list', rooms: roomsList }));
    }
  });
}

function broadcastToRoom(roomId, message) {
  const room = rooms.find(r => r.id === roomId);
  if (room) {
    room.participants.forEach(participant => {
      const client = [...clients.keys()].find(c => c.id === participant.id);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
}

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});