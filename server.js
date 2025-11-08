import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Constants
const PORT = 3000;
const GRID_WIDTH = 15;
const GRID_HEIGHT = 13;
const TICK_RATE = 20;
const BOMB_TIMER = 3000;
const EXPLOSION_DURATION = 500;
const EXPLOSION_RADIUS = 3;
const GAME_RESTART_DELAY = 5000;

const TILE = { EMPTY: 0, SOLID: 1, SOFT: 2 };
const PLAYER_SPAWNS = [
    // ... (same as before)
    { x: 1, y: 1, color: '#2ECC40' }, // Top-left, Green
    { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2, color: '#FF4136' }, // Bottom-right, Red
    { x: GRID_WIDTH - 2, y: 1, color: '#0074D9' }, // Top-right, Blue
    { x: 1, y: GRID_HEIGHT - 2, color: '#FFDC00' }, // Bottom-left, Yellow
];

class GameState {
    constructor() {
        // ... (same properties as before)
        this.players = {};
        this.bombs = {};
        this.explosions = {};
        this.grid = [];
        this.winner = null;
        this.isGameOver = false;
    }

    reset() {
        this.isGameOver = false;
        this.winner = null;
        this.initializeGrid();
        // Respawn players who were connected
        const connectedPlayers = Object.values(this.players);
        this.players = {};
        connectedPlayers.forEach((p, i) => {
            const spawn = PLAYER_SPAWNS[i];
            this.players[p.id] = {
                ...p,
                x: spawn.x,
                y: spawn.y,
                isAlive: true,
                bombsPlaced: 0,
            };
        });
    }

    initializeGrid() {
        // ... (same as before)
        this.grid = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(TILE.EMPTY));

        // Create solid blocks
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                if (y === 0 || y === GRID_HEIGHT - 1 || x === 0 || x === GRID_WIDTH - 1 || (x % 2 === 0 && y % 2 === 0)) {
                    this.grid[y][x] = TILE.SOLID;
                }
            }
        }

        // Define spawn zones
        const spawnZones = [
            { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, // Top-left
            { x: GRID_WIDTH - 2, y: 1 }, { x: GRID_WIDTH - 3, y: 1 }, { x: GRID_WIDTH - 2, y: 2 }, // Top-right
            { x: 1, y: GRID_HEIGHT - 2 }, { x: 1, y: GRID_HEIGHT - 3 }, { x: 2, y: GRID_HEIGHT - 2 }, // Bottom-left
            { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2 }, { x: GRID_WIDTH - 3, y: GRID_HEIGHT - 2 }, { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 3 }, // Bottom-right
        ];

        // Create soft blocks
        for (let y = 1; y < GRID_HEIGHT - 1; y++) {
            for (let x = 1; x < GRID_WIDTH - 1; x++) {
                if (this.grid[y][x] === TILE.EMPTY) {
                    const isSpawnZone = spawnZones.some(zone => zone.x === x && zone.y === y);
                    if (!isSpawnZone && Math.random() < 0.75) {
                        this.grid[y][x] = TILE.SOFT;
                    }
                }
            }
        }
    }

    addPlayer(id, nickname) {
        // ... (same as before)
        const playerCount = Object.keys(this.players).length;
        if (playerCount >= 4) return null; // Game is full

        const spawn = PLAYER_SPAWNS[playerCount];
        const player = {
            id,
            nickname: nickname || `Player ${playerCount + 1}`,
            x: spawn.x,
            y: spawn.y,
            color: spawn.color,
            isAlive: true,
            bombsMax: 1,
            bombsPlaced: 0,
        };
        this.players[id] = player;
        return player;
    }

    removePlayer(id) {
        // ... (same as before)
        delete this.players[id];
    }

    movePlayer(id, direction) {
        // ... (same as before)
        if(this.isGameOver) return;
        const player = this.players[id];
        if (!player || !player.isAlive) return;

        let { x, y } = player;
        switch (direction) {
            case 'up':    y--; break;
            case 'down':  y++; break;
            case 'left':  x--; break;
            case 'right': x++; break;
        }

        // Check for valid movement
        if (this.isPassable(x, y)) {
            player.x = x;
            player.y = y;
        }
    }

    isPassable(x, y) {
        // ... (same as before)
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return false;
        if (this.grid[y][x] === TILE.SOLID || this.grid[y][x] === TILE.SOFT) return false;
        for (const bombId in this.bombs) {
            const bomb = this.bombs[bombId];
            if (bomb.x === x && bomb.y === y) return false;
        }
        return true;
    }

    placeBomb(playerId) {
        // ... (same as before)
        if(this.isGameOver) return;
        const player = this.players[playerId];
        if (!player || !player.isAlive || player.bombsPlaced >= player.bombsMax) {
            return;
        }

        const bombId = `${playerId}-${Date.now()}`;
        this.bombs[bombId] = {
            id: bombId,
            x: player.x,
            y: player.y,
            ownerId: playerId,
            timer: Date.now() + BOMB_TIMER,
        };
        player.bombsPlaced++;
    }

    updateBombs() {
        // ... (same as before)
        const now = Date.now();
        const explodedBombs = [];
        for (const bombId in this.bombs) {
            if (now >= this.bombs[bombId].timer) {
                explodedBombs.push(this.bombs[bombId]);
                delete this.bombs[bombId];
            }
        }
        explodedBombs.forEach(bomb => this.createExplosion(bomb.x, bomb.y, bomb.ownerId));
    }

    createExplosion(x, y, ownerId) {
        // ... (same as before)
        const explosionId = `${x},${y}-${Date.now()}`;
        const explosion = {
            id: explosionId,
            tiles: { [`${x},${y}`]: true },
            createdAt: Date.now(),
        };
        this.explosions[explosionId] = explosion;

        const directions = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
        for (const dir of directions) {
            for (let i = 1; i <= EXPLOSION_RADIUS; i++) {
                const newX = x + dir.dx * i;
                const newY = y + dir.dy * i;

                if (newX < 0 || newX >= GRID_WIDTH || newY < 0 || newY >= GRID_HEIGHT) break;

                const tile = this.grid[newY][newX];
                if (tile === TILE.SOLID) break;

                explosion.tiles[`${newX},${newY}`] = true;

                // Chain reaction
                for (const bombId in this.bombs) {
                    const bomb = this.bombs[bombId];
                    if (bomb.x === newX && bomb.y === newY) {
                        this.createExplosion(bomb.x, bomb.y, bomb.ownerId);
                        delete this.bombs[bombId];
                    }
                }

                if (tile === TILE.SOFT) {
                    this.grid[newY][newX] = TILE.EMPTY;
                    break;
                }
            }
        }

        // Handle player bomb count reset
        const owner = this.players[ownerId];
        if (owner) {
            owner.bombsPlaced--;
        }
    }

    updateExplosions() {
        // ... (same as before)
        const now = Date.now();
        // Player damage
        for (const playerId in this.players) {
            const player = this.players[playerId];
            if (!player.isAlive) continue;
            for (const explosionId in this.explosions) {
                if (this.explosions[explosionId].tiles[`${player.x},${player.y}`]) {
                    player.isAlive = false;
                }
            }
        }
        // Cleanup expired explosions
        for (const explosionId in this.explosions) {
            if (now >= this.explosions[explosionId].createdAt + EXPLOSION_DURATION) {
                delete this.explosions[explosionId];
            }
        }
    }

    checkForWinner() {
        if(this.isGameOver) return;

        const alivePlayers = Object.values(this.players).filter(p => p.isAlive);
        const totalPlayers = Object.keys(this.players).length;

        if (totalPlayers >= 2 && alivePlayers.length <= 1) {
            this.isGameOver = true;
            this.winner = alivePlayers.length === 1 ? alivePlayers[0].nickname : "Draw!";

            setTimeout(() => {
                this.reset();
            }, GAME_RESTART_DELAY);
        }
    }
}

// ... (Express and Socket.IO setup remains the same)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const gameState = new GameState();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
app.get('/controller', (req, res) => res.sendFile(path.join(__dirname, 'public', 'controller.html')));

io.on('connection', (socket) => {
    // ... (join, move, disconnect, bomb)
    console.log(`User connected: ${socket.id}`);

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        gameState.removePlayer(socket.id);
    });

    socket.on('joinGame', (nickname) => {
        const player = gameState.addPlayer(socket.id, nickname);
        if (player) {
            console.log(`${player.nickname} joined the game.`);
        } else {
            socket.emit('gameFull');
        }
    });

    socket.on('move', (direction) => {
        gameState.movePlayer(socket.id, direction);
    });

    socket.on('bomb', () => {
        gameState.placeBomb(socket.id);
    });
});

function gameLoop() {
    gameState.updateBombs();
    gameState.updateExplosions();
    gameState.checkForWinner();
    io.emit('gameState', gameState);
}

server.listen(PORT, () => {
    gameState.reset();
    setInterval(gameLoop, 1000 / TICK_RATE);
    // ... (IP address logging)
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
        console.log(`Access the game via http://localhost:${PORT}`);
    }
});
