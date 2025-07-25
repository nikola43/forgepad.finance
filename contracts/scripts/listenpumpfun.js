import WebSocket from 'ws';

const ws = new WebSocket('wss://pumpportal.fun/api/data');

ws.on('open', function open() {
    // Subscribing to migration events
    let payload = {
        method: "subscribeMigration",
    }
    ws.send(JSON.stringify(payload));
});

ws.on('message', function message(data) {
    console.log(JSON.parse(data));
});