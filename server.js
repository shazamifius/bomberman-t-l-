import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

// Game constants
const GRID_WIDTH = 15;
const GRID_HEIGHT = 13;
const GAME_TICK_RATE = 50;
const PLAYER_SPEED = 0.1;
const BOMB_COOLDOWN = 2000;
const BOMB_DURATION = 3000;
const EXPLOSION_DURATION = 500;
const EXPLOSION_RADIUS = 1;
const GAME_RESTART_DELAY = 5000; // 5 seconds

// Game state
let gameState = {
    players: {},
    bombs: {},
    explosions: {},
    grid: [],
    winner: null,
};
let gameRestartTimer = null;

// Player spawn points and colors
const spawnPoints = [
    { x: 1, y: 1 }, { x: GRID_WIDTH - 2, y: 1 },
    { x: 1, y: GRID_HEIGHT - 2 }, { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2 },
];
const playerColors = ['#FF4136', '#0074D9', '#2ECC40', '#FFDC00'];
let nextPlayerIndex = 0;

function resetGame() {
    clearTimeout(gameRestartTimer);
    gameRestartTimer = null;
    gameState.players = {};
    gameState.bombs = {};
    gameState.explosions = {};
    gameState.winner = null;
    nextPlayerIndex = 0;
    initializeGrid();
    console.log('New game started!');
    io.emit('gameRestart');
}

function initializeGrid() {
    // ... (same as before)
    gameState.grid = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(0));
    // Create indestructible walls (1)
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (y === 0 || y === GRID_HEIGHT - 1 || x === 0 || x === GRID_WIDTH - 1 || (x % 2 === 0 && y % 2 === 0)) {
                gameState.grid[y][x] = 1;
            }
        }
    }
     // Create destructible walls (2)
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
        for (let x = 1; x < GRID_WIDTH - 1; x++) {
            const isSpawnArea = (x <= 2 && y <= 2) || (x >= GRID_WIDTH - 3 && y <= 2) || (x <= 2 && y >= GRID_HEIGHT - 3) || (x >= GRID_WIDTH - 3 && y >= GRID_HEIGHT - 3);
            if (gameState.grid[y][x] === 0 && !isSpawnArea && Math.random() < 0.75) {
                gameState.grid[y][x] = 2;
            }
        }
    }
}

function createExplosion(x, y, ownerId) {
    // ... (same as before)
    const explosionId = `${x}-${y}-${Date.now()}`;
    const explosion = { id: explosionId, x, y, ownerId, tiles: {} };
    gameState.explosions[explosionId] = explosion;

    // Center tile
    explosion.tiles[`${x},${y}`] = true;

    // Directions: up, down, left, right
    const directions = [{dx:0, dy:-1}, {dx:0, dy:1}, {dx:-1, dy:0}, {dx:1, dy:0}];
    for(const dir of directions) {
        for(let i = 1; i <= EXPLOSION_RADIUS; i++) {
            const newX = x + dir.dx * i;
            const newY = y + dir.dy * i;

            if (newX < 0 || newX >= GRID_WIDTH || newY < 0 || newY >= GRID_HEIGHT) break;

            const tile = gameState.grid[newY][newX];
            if (tile === 1) break; // Stop at indestructible walls

            explosion.tiles[`${newX},${newY}`] = true;

            if (tile === 2) break; // Stop after hitting a destructible wall
        }
    }

    io.emit('playSound', 'explosion');

    setTimeout(() => {
        delete gameState.explosions[explosionId];
    }, EXPLOSION_DURATION);
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/controller', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});


io.on('connection', (socket) => {
    // ... (same as before)
    console.log('User connected:', socket.id);

    socket.on('joinGame', (nickname) => {
        if (Object.keys(gameState.players).length >= 4) {
            socket.emit('gameFull');
            return;
        }

        if(gameRestartTimer) { // Don't allow joining mid-restart
            return;
        }

        const playerIndex = nextPlayerIndex % spawnPoints.length;
        const spawnPoint = spawnPoints[playerIndex];

        gameState.players[socket.id] = {
            id: socket.id,
            x: spawnPoint.x,
            y: spawnPoint.y,
            nickname: nickname || `Player ${playerIndex + 1}`,
            color: playerColors[playerIndex],
            lastBombTime: 0,
            isAlive: true,
        };
        nextPlayerIndex++;
        console.log(`Player ${gameState.players[socket.id].nickname} joined the game.`);
        io.emit('playerJoined', `+1 ${gameState.players[socket.id].nickname} connected`);
    });

    socket.on('move', (direction) => {
        const player = gameState.players[socket.id];
        if (!player || !player.isAlive) return;

        let { x, y } = player;

        switch (direction) {
            case 'up':    y -= PLAYER_SPEED; break;
            case 'down':  y += PLAYER_SPEED; break;
            case 'left':  x -= PLAYER_SPEED; break;
            case 'right': x += PLAYER_SPEED; break;
        }

        // Collision detection
        const gridX = Math.round(x);
        const gridY = Math.round(y);

        if (gameState.grid[gridY] && gameState.grid[gridY][gridX] === 0) {
             player.x = x;
             player.y = y;
        }
    });

    socket.on('placeBomb', () => {
        const player = gameState.players[socket.id];
        if (!player || !player.isAlive || gameState.winner) return;

        const now = Date.now();
        if (now - player.lastBombTime < BOMB_COOLDOWN) return;

        const gridX = Math.round(player.x);
        const gridY = Math.round(player.y);

        if (Object.values(gameState.bombs).some(b => b.x === gridX && b.y === gridY)) return;

        player.lastBombTime = now;
        const bombId = `${socket.id}-${now}`;
        gameState.bombs[bombId] = {
            id: bombId,
            x: gridX,
            y: gridY,
            createdAt: now,
            ownerId: socket.id,
        };
        io.emit('playSound', 'placeBomb');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (gameState.players[socket.id]) {
            io.emit('playerLeft', `${gameState.players[socket.id].nickname} left`);
            delete gameState.players[socket.id];
        }
         // If no players left, reset
        if(Object.keys(gameState.players).length === 0){
             resetGame();
        }
    });
});

function checkForWinner() {
    if (gameState.winner) return;

    const alivePlayers = Object.values(gameState.players).filter(p => p.isAlive);

    if (alivePlayers.length <= 1 && Object.keys(gameState.players).length > 1) {
        const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;
        gameState.winner = winner ? winner.nickname : "It's a draw!";
        console.log('Game Over! Winner:', gameState.winner);
        io.emit('gameOver', gameState.winner);
        io.emit('playSound', 'victory');

        gameRestartTimer = setTimeout(resetGame, GAME_RESTART_DELAY);
    }
}

// Main game loop
setInterval(() => {
    if(gameRestartTimer) return; // Pause updates while waiting to restart
    const now = Date.now();
    // ... Bomb and explosion logic from before ...
     for (const bombId in gameState.bombs) {
        const bomb = gameState.bombs[bombId];
        if (now - bomb.createdAt >= BOMB_DURATION) {
            createExplosion(bomb.x, bomb.y, bomb.ownerId);
            delete gameState.bombs[bombId];
        }
    }

    // Check for collisions with explosions
    for (const explosionId in gameState.explosions) {
        const explosion = gameState.explosions[explosionId];
        // Check player collision
        for(const playerId in gameState.players) {
            const player = gameState.players[playerId];
            if (!player.isAlive) continue;
            const playerGridX = Math.round(player.x);
            const playerGridY = Math.round(player.y);
            if (explosion.tiles[`${playerGridX},${playerGridY}`]) {
                player.isAlive = false;
                io.emit('playerDied', { id: playerId, nickname: player.nickname });
            }
        }
        // Check and destroy destructible walls
        for(const tileKey in explosion.tiles) {
            const [x, y] = tileKey.split(',').map(Number);
            if(gameState.grid[y][x] === 2) {
                gameState.grid[y][x] = 0; // Destroy wall
            }
            // Check for bomb chain reactions
            for(const bombId in gameState.bombs) {
                const bomb = gameState.bombs[bombId];
                if(bomb.x === x && bomb.y === y) {
                   createExplosion(bomb.x, bomb.y, bomb.ownerId);
                   delete gameState.bombs[bombId];
                }
            }
        }
    }

    checkForWinner();

    io.emit('gameState', gameState);
}, GAME_TICK_RATE);

server.listen(PORT, () => {
    resetGame();
    const networkInterfaces = os.networkInterfaces();
    let localIp = '';

    Object.keys(networkInterfaces).forEach(ifaceName => {
        networkInterfaces[ifaceName].forEach(iface => {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIp = iface.address;
            }
        });
    });

    console.log(`🚀 Server is running!`);
    if (localIp) {
        console.log(`🎮 Game screen: http://${localIp}:${PORT}`);
        console.log(`🕹️ Controller:  http://${localIp}:${PORT}/controller`);
    } else {
        console.log(`Could not determine local IP address. Access the game via http://localhost:${PORT}`);
    }
});
