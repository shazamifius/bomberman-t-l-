import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Constants
// ... (same as before)
const PORT = 3000;
const GRID_WIDTH = 21;
const GRID_HEIGHT = 21;
const TICK_RATE = 20;
const BOMB_TIMER = 3000;
const EXPLOSION_DURATION = 3000;
const GAME_RESTART_DELAY = 5000;
const POWER_UP_SPAWN_CHANCE = 0.3;

const TILE = { EMPTY: 0, SOLID: 1, SOFT: 2 };
const POWER_UP_TYPES = {
    SPEED: 'speed',
    BOMB_COUNT: 'bomb_count',
    BOMB_RANGE: 'bomb_range',
};
const ALL_POWER_UPS = Object.values(POWER_UP_TYPES);
const PLAYER_SPAWNS = [
    { x: 1, y: 1 },
    { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2 },
    { x: GRID_WIDTH - 2, y: 1 },
    { x: 1, y: GRID_HEIGHT - 2 },
];
const PLAYER_COLORS = [
    '#2ECC40', '#FF4136', '#0074D9', '#FFDC00', '#FF851B', '#7FDBFF', '#B10DC9', '#F012BE',
    '#3D9970', '#85144b', '#39CCCC', '#01FF70', '#AAAAAA', '#DDDDDD', '#FFFFFF', '#111111', '#E6E6FA'
];


class GameState {
    constructor() {
        // ... (properties)
        this.players = {};
        this.bombs = {};
        this.explosions = {};
        this.powerUps = {};
        this.grid = [];
        this.winner = null;
        this.isGameOver = false;
        this.diffs = [];
    }

    queueUpdate(type, data) {
        this.diffs.push({ type, data });
    }

    reset() {
        this.isGameOver = true; // Game is paused until countdown finishes
        this.winner = null;
        this.bombs = {};
        this.explosions = {};
        this.powerUps = {};
        this.initializeGrid();

        const connectedPlayers = Object.values(this.players);
        this.players = {};
        connectedPlayers.forEach((p, i) => {
            const spawn = this.findSpawnPoint(i);
            this.players[p.id] = {
                ...p,
                x: spawn.x,
                y: spawn.y,
                isAlive: true,
                bombsMax: 1,
                bombsPlaced: 0,
                explosionRadius: 2,
                speed: 1,
                direction: 'down',
            };
        });
        this.queueUpdate('fullState', this.getStateForClient());
    }

    initializeGrid() {
        this.grid = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(TILE.EMPTY));

        // 1. Generate the inverted map
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                const isBorder = y === 0 || y === GRID_HEIGHT - 1 || x === 0 || x === GRID_WIDTH - 1;
                const wasPillarInOldMap = (x % 2 === 0 && y % 2 === 0);

                if (isBorder) {
                    this.grid[y][x] = TILE.SOLID;
                } else {
                    // Inside the border, invert the logic
                    if (wasPillarInOldMap) {
                        this.grid[y][x] = TILE.EMPTY; // Pillars become empty
                    } else {
                        this.grid[y][x] = TILE.SOLID; // Paths become solid
                    }
                }
            }
        }

        // 2. Define spawn zones and ensure they are clear of any blocks
        let spawnZones = [];
        PLAYER_SPAWNS.forEach(spawn => {
            for(let dy = -1; dy <= 1; dy++) {
                for(let dx = -1; dx <=1; dx++) {
                    const sx = spawn.x + dx;
                    const sy = spawn.y + dy;
                    // Check bounds just in case, though spawns are well within bounds
                    if (sx >= 0 && sx < GRID_WIDTH && sy >= 0 && sy < GRID_HEIGHT) {
                       // Don't clear the outer border wall
                       if (sx !== 0 && sx !== GRID_WIDTH - 1 && sy !== 0 && sy !== GRID_HEIGHT - 1) {
                           this.grid[sy][sx] = TILE.EMPTY;
                           spawnZones.push({x: sx, y: sy});
                       }
                    }
                }
            }
        });

        // 3. Place soft blocks randomly on available empty tiles, avoiding spawn zones
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
        // ... (addPlayer logic)
        const playerCount = Object.keys(this.players).length;
        if (playerCount >= 17) return null;

        const spawn = this.findSpawnPoint(playerCount);
        const player = {
            id,
            nickname: nickname || `Player ${playerCount + 1}`,
            x: spawn.x,
            y: spawn.y,
            color: PLAYER_COLORS[playerCount % PLAYER_COLORS.length],
            isAlive: true,
            bombsMax: 1,
            bombsPlaced: 0,
            explosionRadius: 2,
            speed: 1,
            direction: 'down',
        };
        this.players[id] = player;
        this.queueUpdate('playerJoined', player);
        return player;
    }

    removePlayer(id) {
        delete this.players[id];
        this.queueUpdate('playerLeft', { id });
    }

    movePlayer(id, direction) {
        if(this.isGameOver) return;
        const player = this.players[id];
        if (!player || !player.isAlive) return;

        player.direction = direction; // Set direction regardless of move success

        let { x, y } = player;
        switch (direction) {
            case 'up':    y--; break;
            case 'down':  y++; break;
            case 'left':  x--; break;
            case 'right': x++; break;
        }

        const nextX = x;
        const nextY = y;

        if (this.isPassable(nextX, nextY)) {
            player.x = nextX;
            player.y = nextY;
            this.queueUpdate('playerMoved', { id, x: nextX, y: nextY, direction });
            this.checkPowerUpCollision(id);
        } else {
            this.queueUpdate('playerFaced', { id, direction });
        }
    }

    isPassable(x, y) {
        // ... (isPassable logic)
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return false;
        if (this.grid[y][x] === TILE.SOLID || this.grid[y][x] === TILE.SOFT) return false;
        for (const bombId in this.bombs) {
            const bomb = this.bombs[bombId];
            if (bomb.x === x && bomb.y === y) return false;
        }
        return true;
    }

    // ... (rest of methods are the same)
    placeBomb(playerId) {
        if(this.isGameOver) return;
        const player = this.players[playerId];
        if (!player || !player.isAlive || player.bombsPlaced >= player.bombsMax) {
            return;
        }

        const bombId = `${playerId}-${Date.now()}`;
        const bomb = {
            id: bombId,
            x: player.x,
            y: player.y,
            ownerId: playerId,
            timer: Date.now() + BOMB_TIMER,
            radius: player.explosionRadius,
        };
        this.bombs[bombId] = bomb;
        player.bombsPlaced++;
        this.queueUpdate('bombPlaced', bomb);
    }

    updateBombs() {
        const now = Date.now();
        const explodedBombs = [];
        for (const bombId in this.bombs) {
            if (now >= this.bombs[bombId].timer) {
                explodedBombs.push(this.bombs[bombId]);
                delete this.bombs[bombId];
            }
        }
        explodedBombs.forEach(bomb => this.createExplosion(bomb.x, bomb.y, bomb.ownerId, bomb.radius));
    }

    createExplosion(x, y, ownerId, radius) {
        const explosionId = `${x},${y}-${Date.now()}`;
        const explosion = {
            id: explosionId,
            tiles: { [`${x},${y}`]: true },
            createdAt: Date.now(),
        };

        const directions = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
        for (const dir of directions) {
            for (let i = 1; i <= radius; i++) {
                const newX = x + dir.dx * i;
                const newY = y + dir.dy * i;

                if (newX < 0 || newX >= GRID_WIDTH || newY < 0 || newY >= GRID_HEIGHT) break;

                const tile = this.grid[newY][newX];
                if (tile === TILE.SOLID) break;

                explosion.tiles[`${newX},${newY}`] = true;

                for (const bombId in this.bombs) {
                    const bomb = this.bombs[bombId];
                    if (bomb.x === newX && bomb.y === newY) {
                        this.createExplosion(bomb.x, bomb.y, bomb.ownerId, bomb.radius);
                        delete this.bombs[bombId];
                    }
                }

                if (tile === TILE.SOFT) {
                    this.grid[newY][newX] = TILE.EMPTY;
                    this.queueUpdate('tileChanged', {x: newX, y: newY, type: TILE.EMPTY});
                    this.trySpawnPowerUp(newX, newY);
                    break;
                }
            }
        }
        this.explosions[explosionId] = explosion;
        this.queueUpdate('explosion', explosion);

        const owner = this.players[ownerId];
        if (owner) {
            owner.bombsPlaced--;
        }
    }

    updateExplosions() {
        const now = Date.now();
        for (const playerId in this.players) {
            const player = this.players[playerId];
            if (!player.isAlive) continue;
            for (const explosionId in this.explosions) {
                if (this.explosions[explosionId].tiles[`${player.x},${player.y}`]) {
                    player.isAlive = false;
                    this.queueUpdate('playerDied', { id: playerId });
                }
            }
        }
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
            this.queueUpdate('gameOver', { winner: this.winner });

            setTimeout(() => {
                this.startRound();
            }, GAME_RESTART_DELAY);
        }
    }

    getStateForClient() {
        return {
            players: this.players,
            bombs: this.bombs,
            explosions: this.explosions,
            grid: this.grid,
            powerUps: this.powerUps,
            winner: this.winner,
        };
    }

    trySpawnPowerUp(x, y) {
        if (Math.random() < POWER_UP_SPAWN_CHANCE) {
            const type = ALL_POWER_UPS[Math.floor(Math.random() * ALL_POWER_UPS.length)];
            const id = `powerup-${x}-${y}`;
            const powerUp = { id, x, y, type };
            this.powerUps[id] = powerUp;
            this.queueUpdate('powerUpSpawned', powerUp);
        }
    }

    checkPowerUpCollision(playerId) {
        const player = this.players[playerId];
        if (!player) return;

        const powerUpId = Object.keys(this.powerUps).find(id => {
            const p = this.powerUps[id];
            return p.x === player.x && p.y === player.y;
        });

        if (powerUpId) {
            const powerUp = this.powerUps[powerUpId];
            switch (powerUp.type) {
                case POWER_UP_TYPES.SPEED:
                    player.speed = Math.min(player.speed + 0.5, 3); // Cap speed
                    break;
                case POWER_UP_TYPES.BOMB_COUNT:
                    player.bombsMax++;
                    break;
                case POWER_UP_TYPES.BOMB_RANGE:
                    player.explosionRadius++;
                    break;
            }
            delete this.powerUps[powerUpId];
            this.queueUpdate('powerUpCollected', { id: powerUpId, playerId: player.id });
        }
    }

    findSpawnPoint(playerIndex) {
        if (playerIndex < 4) {
            return PLAYER_SPAWNS[playerIndex];
        }

        let bestSpot = { x: -1, y: -1 };
        let maxDist = -1;

        for (let y = 1; y < GRID_HEIGHT - 1; y++) {
            for (let x = 1; x < GRID_WIDTH - 1; x++) {
                if (this.grid[y][x] === TILE.EMPTY) {
                    let minDistToPlayer = Infinity;
                    const activePlayers = Object.values(this.players);
                    if (activePlayers.length === 0) {
                         return {x, y};
                    }

                    for (const player of activePlayers) {
                        const dist = Math.hypot(x - player.x, y - player.y);
                        if (dist < minDistToPlayer) {
                            minDistToPlayer = dist;
                        }
                    }

                    if (minDistToPlayer > maxDist) {
                        maxDist = minDistToPlayer;
                        bestSpot = { x, y };
                    }
                }
            }
        }
        return bestSpot;
    }
}


// --- Server Setup ---
// ... (same as before)
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
    console.log(`User connected: ${socket.id}`);

    socket.emit('fullState', gameState.getStateForClient());

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        gameState.removePlayer(socket.id);
    });

    socket.on('joinGame', (nickname) => {
        const player = gameState.addPlayer(socket.id, nickname);
        if (!player) {
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
    if (gameState.isGameOver) return; // Pause game logic when game is over
    gameState.updateBombs();
    gameState.updateExplosions();
    gameState.checkForWinner();

    if (gameState.diffs.length > 0) {
        io.emit('gameUpdate', gameState.diffs);
        gameState.diffs = [];
    }
}

// --- Add startRound to GameState class ---
GameState.prototype.startRound = function() {
    this.reset();
    let count = 5;
    const countdownInterval = setInterval(() => {
        this.queueUpdate('countdown', { value: count });
        io.emit('gameUpdate', this.diffs);
        this.diffs = [];
        count--;
        if (count < 0) {
            clearInterval(countdownInterval);
            this.isGameOver = false; // Start the game
        }
    }, 1000);
};


server.listen(PORT, () => {
    gameState.startRound();
    setInterval(gameLoop, 1000 / TICK_RATE);

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
