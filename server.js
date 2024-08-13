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

function logState() {
  console.log(`Available speakers: ${availableSpeakers.length}, Waiting clients: ${waitingClients.length}`);
}

function checkWaitingClients() {
  console.log('Checking waiting clients...');
  while (waitingClients.length > 0 && availableSpeakers.length > 0) {
    const client = waitingClients.shift();
    const speaker = availableSpeakers.shift();
    if (client.readyState === WebSocket.OPEN && speaker.readyState === WebSocket.OPEN) {
      console.log('Pairing a client with a speaker');
      client.send(JSON.stringify({ type: 'speaker_connected' }));
      speaker.send(JSON.stringify({ type: 'client_connected' }));
    } else {
      console.log('Client or speaker disconnected before pairing');
      if (client.readyState === WebSocket.OPEN) waitingClients.unshift(client);
      if (speaker.readyState === WebSocket.OPEN) availableSpeakers.unshift(speaker);
    }
  }
  logState();
}

setInterval(checkWaitingClients, 5000); // Check every 5 seconds

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  logState();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);

      if (data.type === 'request_speaker') {
        if (availableSpeakers.length > 0) {
          const speaker = availableSpeakers.shift();
          console.log('Pairing client with available speaker');
          ws.send(JSON.stringify({ type: 'speaker_connected' }));
          speaker.send(JSON.stringify({ type: 'client_connected' }));
        } else {
          console.log('No available speakers, adding client to waiting list');
          waitingClients.push(ws);
          ws.send(JSON.stringify({ type: 'waiting_for_speaker' }));
        }
      } else if (data.type === 'available_as_speaker') {
        if (waitingClients.length > 0) {
          const client = waitingClients.shift();
          console.log('Pairing available speaker with waiting client');
          client.send(JSON.stringify({ type: 'speaker_connected' }));
          ws.send(JSON.stringify({ type: 'client_connected' }));
        } else {
          console.log('No waiting clients, adding speaker to available list');
          availableSpeakers.push(ws);
        }
      } else if (data.type === 'end_call') {
        console.log('Call ended');
        // Optionally, you can add the speaker back to the available list
        availableSpeakers.push(ws);
      }
      logState();
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    availableSpeakers = availableSpeakers.filter(speaker => speaker !== ws);
    waitingClients = waitingClients.filter(client => client !== ws);
    logState();
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on port ${server.address().port}`);
});