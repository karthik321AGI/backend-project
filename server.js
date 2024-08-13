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

function checkWaitingClients() {
  while (waitingClients.length > 0 && availableSpeakers.length > 0) {
    const client = waitingClients.shift();
    const speaker = availableSpeakers.pop();
    client.send(JSON.stringify({ type: 'speaker_connected' }));
    speaker.send(JSON.stringify({ type: 'client_connected' }));
  }
}

setInterval(checkWaitingClients, 5000); // Check every 5 seconds

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);

      if (data.type === 'request_speaker') {
        if (availableSpeakers.length > 0) {
          const speaker = availableSpeakers.pop();
          ws.send(JSON.stringify({ type: 'speaker_connected' }));
          speaker.send(JSON.stringify({ type: 'client_connected' }));
        } else {
          waitingClients.push(ws);
          ws.send(JSON.stringify({ type: 'waiting_for_speaker' }));
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
        console.log('Call ended');
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    availableSpeakers = availableSpeakers.filter(speaker => speaker !== ws);
    waitingClients = waitingClients.filter(client => client !== ws);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on port ${server.address().port}`);
});