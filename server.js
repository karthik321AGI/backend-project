const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let waitingUsers = [];
let activeCalls = new Map();

function logState() {
  console.log(`Waiting users: ${waitingUsers.length}, Active calls: ${activeCalls.size}`);
}

function pairUsers() {
  while (waitingUsers.length >= 2) {
    const user1 = waitingUsers.shift();
    const user2 = waitingUsers.shift();
    if (user1.readyState === WebSocket.OPEN && user2.readyState === WebSocket.OPEN) {
      console.log('Pairing two users');
      user1.send(JSON.stringify({ type: 'connection_established', initiator: true }));
      user2.send(JSON.stringify({ type: 'connection_established', initiator: false }));
      activeCalls.set(user1, user2);
      activeCalls.set(user2, user1);
    } else {
      console.log('One or both users disconnected before pairing');
      if (user1.readyState === WebSocket.OPEN) waitingUsers.unshift(user1);
      if (user2.readyState === WebSocket.OPEN) waitingUsers.unshift(user2);
    }
  }
  logState();
}

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  logState();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);

      switch (data.type) {
        case 'request_connection':
          if (waitingUsers.length > 0) {
            const peer = waitingUsers.shift();
            console.log('Pairing user with waiting user');
            ws.send(JSON.stringify({ type: 'connection_established', initiator: true }));
            peer.send(JSON.stringify({ type: 'connection_established', initiator: false }));
            activeCalls.set(ws, peer);
            activeCalls.set(peer, ws);
          } else {
            console.log('No waiting users, adding user to waiting list');
            waitingUsers.push(ws);
            ws.send(JSON.stringify({ type: 'waiting_for_peer' }));
          }
          break;
        case 'offer':
        case 'answer':
        case 'ice_candidate':
          const peer = activeCalls.get(ws);
          if (peer) {
            peer.send(JSON.stringify(data));
          }
          break;
        case 'end_call':
          console.log('Call ended');
          const callPeer = activeCalls.get(ws);
          if (callPeer) {
            activeCalls.delete(ws);
            activeCalls.delete(callPeer);
            callPeer.send(JSON.stringify({ type: 'call_ended' }));
          }
          break;
      }
      logState();
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    waitingUsers = waitingUsers.filter(user => user !== ws);
    const peer = activeCalls.get(ws);
    if (peer) {
      activeCalls.delete(ws);
      activeCalls.delete(peer);
      peer.send(JSON.stringify({ type: 'call_ended' }));
    }
    logState();
  });
});

// Periodically check and pair waiting users
setInterval(pairUsers, 1000);

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on port ${server.address().port}`);
});