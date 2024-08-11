const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let availableSpeakers = [];
let waitingClients = [];

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.type === 'request_speaker') {
      if (availableSpeakers.length > 0) {
        const speaker = availableSpeakers.pop();
        ws.send(JSON.stringify({ type: 'speaker_connected' }));
        speaker.send(JSON.stringify({ type: 'client_connected' }));
      } else {
        waitingClients.push(ws);
      }
    } else if (data.type === 'available_as_speaker') {
      if (waitingClients.length > 0) {
        const client = waitingClients.shift();
        client.send(JSON.stringify({ type: 'speaker_connected' }));
        ws.send(JSON.stringify({ type: 'client_connected' }));
      } else {
        availableSpeakers.push(ws);
      }
    } else if (data.type === 'end_call') {
      // Handle call ending logic
    }
  });

  ws.on('close', () => {
    availableSpeakers = availableSpeakers.filter(speaker => speaker !== ws);
    waitingClients = waitingClients.filter(client => client !== ws);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Server is running');
});
