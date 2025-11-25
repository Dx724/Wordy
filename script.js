
const GRID_SIZE = 10;
const CELL_SIZE = 40;
const CHUNK_WIDTH_PX = (GRID_SIZE * CELL_SIZE);
const CHUNK_HEIGHT_PX = CHUNK_WIDTH_PX;

const gameContainer = document.getElementById('game-container');
const world = document.getElementById('world');
const wordCountEl = document.getElementById('word-count');
const avgLenEl = document.getElementById('avg-len');
const messageArea = document.getElementById('message-area');
const dragLine = document.getElementById('drag-line');

let placementWords = [];
let obscureWords = []; // Words from the bigger dictionary with length >= 6
let prefixMap = {}; // Key: 2-letter prefix, Value: array of words with that prefix
let chunks = {}; // Key: "gx,gy", Value: Cell Element
let chunkElements = {}; // Key: "cx,cy", Value: Chunk Element
let occupiedChunks = new Set(); // Key: "cx,cy"
let mostRecentChunk = { cx: 0, cy: 0 }; // Track most recent chunk for camera positioning

let isPanning = false;
let isSelecting = false;
let startPanX, startPanY;
let panX = 0, panY = 0;
let scale = 1.0; // Zoom level
let initialPinchDistance = 0; // For pinch-to-zoom
let startScale = 1.0; // Scale at start of pinch
let lastPinchCenterX = 0; // Track pinch center for delta calculation
let lastPinchCenterY = 0;
let selectionStartCell = null;
let currentSelection = [];
let foundWordsCount = 0;
let foundLettersCount = 0;

// Speed Mode state
let isSpeedMode = false;
let speedModeScore = 0;
let totalSpeedScore = 0;
let maxSpeedScore = 0;
let speedModeTimer = null;
let speedModeTimeRemaining = 60;
let speedModeStartTime = 0;
let savedGameState = null; // Store normal mode state

// Initialize
init();

function init() {
    processDictionaries();

    // Try to load saved game state
    const loaded = loadGameState();

    if (!loaded) {
        // No save found, create initial chunk at 0,0
        createChunk(0, 0);

        // Center the world initially
        panX = -CHUNK_WIDTH_PX / 2;
        panY = -CHUNK_HEIGHT_PX / 2;
        updateWorldTransform();
    }

    // Event Listeners
    gameContainer.addEventListener('mousedown', handleInputStart);
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('mouseup', handleInputEnd);
    gameContainer.addEventListener('wheel', handleWheel, { passive: false });

    // Touch support - pass full event to preserve touches array for multitouch detection
    gameContainer.addEventListener('touchstart', handleInputStart);
    window.addEventListener('touchmove', handleInputMove);
    window.addEventListener('touchend', handleInputEnd);

    // Speed Mode button
    const speedModeBtn = document.getElementById('speed-mode-btn');
    if (speedModeBtn) {
        speedModeBtn.addEventListener('click', toggleSpeedMode);
    }

    // Update UI elements
    updateScoreDisplay();
}

function processDictionaries() {
    // Process Placement Dictionary (from dictionary.js)
    if (typeof DICTIONARY !== 'undefined') {
        DICTIONARY.forEach(word => {
            if (word.length >= 5 && word.length <= 7) {
                placementWords.push(word);
            }
        });
    } else {
        console.error("Placement dictionary not loaded!");
        ["APPLE", "BRAIN", "CHAIR", "DANCE", "EAGLE"].forEach(w => placementWords.push(w));
    }

    // Build prefix map for efficient cross-chunk word placement
    placementWords.forEach(word => {
        if (word.length >= 4) {
            const prefix = word.substring(0, 2);
            if (!prefixMap[prefix]) {
                prefixMap[prefix] = [];
            }
            prefixMap[prefix].push(word);
        }
    });

    // Validation Dictionary is already a Set in VALIDATION_DICT (from all_words.js)
    if (typeof VALIDATION_DICT === 'undefined') {
        console.error("Validation dictionary not loaded!");
        window.VALIDATION_DICT = new Set(placementWords);
    } else {
        // Populate obscureWords
        VALIDATION_DICT.forEach(word => {
            if (word.length >= 6) {
                obscureWords.push(word);
            }
        });
        console.log(`Loaded ${obscureWords.length} obscure words.`);
    }
}

// Serialize current game state to an object
function serializeGameState() {
    const state = {
        version: 1,
        savedAt: Date.now(),
        score: {
            foundWordsCount,
            foundLettersCount
        },
        totalSpeedScore,
        maxSpeedScore,
        mostRecentChunk,
        panX,
        panY,
        scale,
        chunks: []
    };

    // Serialize all chunks
    occupiedChunks.forEach(chunkKey => {
        const [cx, cy] = chunkKey.split(',').map(Number);
        const chunkData = {
            cx,
            cy,
            cells: []
        };

        // Serialize all cells in this chunk
        for (let ly = 0; ly < GRID_SIZE; ly++) {
            for (let lx = 0; lx < GRID_SIZE; lx++) {
                const gx = cx * GRID_SIZE + lx;
                const gy = cy * GRID_SIZE + ly;
                const cell = chunks[`${gx},${gy}`];

                if (cell) {
                    chunkData.cells.push({
                        letter: cell.textContent,
                        found: cell.classList.contains('found'),
                        used: cell.classList.contains('used')
                    });
                }
            }
        }

        state.chunks.push(chunkData);
    });

    return state;
}

// Save game state to localStorage
function saveGameState() {
    try {
        const state = serializeGameState();
        localStorage.setItem('wordSearchGameState', JSON.stringify(state));
        console.log('Game state saved');
    } catch (error) {
        console.error('Failed to save game state:', error);
    }
}

// Restore game state from a serialized object
function restoreGameState(state, updateScore = true) {
    // Clear current state
    world.innerHTML = '';
    chunks = {};
    chunkElements = {};
    occupiedChunks.clear();

    // Restore score
    foundWordsCount = state.score.foundWordsCount || 0;
    foundLettersCount = state.score.foundLettersCount || 0;

    // Restore most recent chunk
    mostRecentChunk = state.mostRecentChunk || { cx: 0, cy: 0 };

    // Restore camera position
    if (state.panX !== undefined) panX = state.panX;
    if (state.panY !== undefined) panY = state.panY;
    if (state.scale !== undefined) scale = state.scale;

    // Restore all chunks
    state.chunks.forEach(chunkData => {
        const { cx, cy, cells } = chunkData;

        // Create chunk element
        const chunkEl = document.createElement('div');
        chunkEl.className = 'grid-chunk';
        chunkEl.style.left = `${cx * CHUNK_WIDTH_PX}px`;
        chunkEl.style.top = `${cy * CHUNK_HEIGHT_PX}px`;
        chunkEl.dataset.cx = cx;
        chunkEl.dataset.cy = cy;

        // Create cells with saved data
        cells.forEach((cellData, index) => {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.textContent = cellData.letter;

            const localX = index % GRID_SIZE;
            const localY = Math.floor(index / GRID_SIZE);
            const gx = cx * GRID_SIZE + localX;
            const gy = cy * GRID_SIZE + localY;

            cell.dataset.gx = gx;
            cell.dataset.gy = gy;

            // Restore cell state
            if (cellData.found) cell.classList.add('found');
            if (cellData.used) cell.classList.add('used');

            chunkEl.appendChild(cell);
            chunks[`${gx},${gy}`] = cell;
        });

        world.appendChild(chunkEl);
        chunkElements[`${cx},${cy}`] = chunkEl;
        occupiedChunks.add(`${cx},${cy}`);
    });

    if (updateScore) {
        // Restore total speed score and max score
        totalSpeedScore = state.totalSpeedScore || 0;
        maxSpeedScore = state.maxSpeedScore || 0;

        const totalScoreEl = document.getElementById('total-speed-score');
        if (totalScoreEl) {
            totalScoreEl.textContent = totalSpeedScore;
        }
        const maxScoreEl = document.getElementById('max-speed-score');
        if (maxScoreEl) {
            maxScoreEl.textContent = maxSpeedScore;
        }
    }

    updateWorldTransform();
    updateScoreDisplay();
}

// Load game state from localStorage
function loadGameState() {
    try {
        const saved = localStorage.getItem('wordSearchGameState');
        if (!saved) return false;

        const state = JSON.parse(saved);

        // Restore game state
        restoreGameState(state);

        // Center camera on most recent chunk
        panToChunk(mostRecentChunk.cx, mostRecentChunk.cy);

        console.log('Game state loaded');
        return true;
    } catch (error) {
        console.error('Failed to load game state:', error);
        return false;
    }
}

function createChunk(cx, cy, sx = null, sy = null, dir = null) {
    const key = `${cx},${cy}`;
    if (occupiedChunks.has(key)) return;

    const chunkEl = document.createElement('div');
    chunkEl.className = 'grid-chunk newly-added';
    chunkEl.style.left = `${cx * CHUNK_WIDTH_PX}px`;
    chunkEl.style.top = `${cy * CHUNK_HEIGHT_PX}px`;
    chunkEl.dataset.cx = cx;
    chunkEl.dataset.cy = cy;

    const gridData = generateGridData(cx, cy, sx, sy, dir);

    gridData.forEach((letter, index) => {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = letter;

        const localX = index % GRID_SIZE;
        const localY = Math.floor(index / GRID_SIZE);
        const gx = cx * GRID_SIZE + localX;
        const gy = cy * GRID_SIZE + localY;

        cell.dataset.gx = gx;
        cell.dataset.gy = gy;

        chunkEl.appendChild(cell);
        chunks[`${gx},${gy}`] = cell;
    });

    world.appendChild(chunkEl);
    chunkElements[key] = chunkEl;
    occupiedChunks.add(key);

    // Track most recent chunk
    mostRecentChunk = { cx, cy };

    setTimeout(() => chunkEl.classList.remove('newly-added'), 600);
}

function generateGridData(cx, cy, sx = null, sy = null, dir = null) {
    const grid = new Array(GRID_SIZE * GRID_SIZE).fill(null);

    // Try cross-chunk placement first if source info is provided
    if (sx !== null && sy !== null && dir !== null) {
        placeCrossChunkWordInGrid(grid, cx, cy, sx, sy, dir);
    }

    const wordsToPlace = 3 + Math.floor(Math.random() * 3);

    let placedCount = 0;
    //console.log(`Placing ${wordsToPlace} words`);
    for (let i = 0; i < wordsToPlace || placedCount == 0; i++) {
        if (placementWords.length > 0) {
            const word = placementWords[Math.floor(Math.random() * placementWords.length)];
            if (placeWord(grid, word)) {
                placedCount++;
                //console.log(`Placed ${word}`);
            }
        }
    }
    //console.log(`Placed ${placedCount} words`);

    // Try to place one obscure word from the bigger dictionary
    if (obscureWords.length > 0) {
        // Try 10 times to find a word that fits
        for (let i = 0; i < 10; i++) {
            const obscureWord = obscureWords[Math.floor(Math.random() * obscureWords.length)];
            if (placeWord(grid, obscureWord)) {
                //console.log(`Placed obscure word: ${obscureWord}`);
                break;
            }
        }
    }

    // Seed the grid with 2-letter prefixes near edges for better cross-chunk placement
    seedPrefixesNearEdges(grid);

    for (let i = 0; i < grid.length; i++) {
        if (!grid[i]) {
            grid[i] = String.fromCharCode(65 + Math.floor(Math.random() * 26));
        }
    }
    return grid;
}

function placeWord(grid, word) {
    const directions = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, // Horizontal
        { dx: 0, dy: 1 }, { dx: 0, dy: -1 }, // Vertical
        { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, // Diagonal Right
        { dx: -1, dy: 1 }, { dx: -1, dy: -1 } // Diagonal Left
    ];

    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 50) {
        const dir = directions[Math.floor(Math.random() * directions.length)];
        const startX = Math.floor(Math.random() * GRID_SIZE);
        const startY = Math.floor(Math.random() * GRID_SIZE);

        if (canPlace(grid, word, startX, startY, dir)) {
            for (let i = 0; i < word.length; i++) {
                const x = startX + i * dir.dx;
                const y = startY + i * dir.dy;
                grid[y * GRID_SIZE + x] = word[i];
            }
            placed = true;
        }
        attempts++;
    }
    return placed;
}

function canPlace(grid, word, startX, startY, dir) {
    for (let i = 0; i < word.length; i++) {
        const x = startX + i * dir.dx;
        const y = startY + i * dir.dy;
        if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return false;
        const idx = y * GRID_SIZE + x;
        if (grid[idx] !== null && grid[idx] !== word[i]) return false;
    }
    return true;
}

function seedPrefixesNearEdges(grid) {
    // Get all available prefixes
    const allPrefixes = Object.keys(prefixMap);
    if (allPrefixes.length === 0) return;

    // Try to place 2 random prefixes near edges
    const numSeeds = 2;

    for (let seedAttempt = 0; seedAttempt < numSeeds; seedAttempt++) {
        // Pick a random prefix
        const prefix = allPrefixes[Math.floor(Math.random() * allPrefixes.length)];

        // Define edge positions with outward-pointing directions
        // Both letters are inside the chunk, but oriented so the word can extend out
        const edgePositions = [];

        // Top edge (y=0 or y=1): place prefixes pointing UP (so 3rd letter would be outside)
        for (let x = 1; x < GRID_SIZE - 1; x++) {
            edgePositions.push({ x, y: 1, directions: [{ dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: -1 }] });
        }

        // Bottom edge (y=GRID_SIZE-1 or y=GRID_SIZE-2): place prefixes pointing DOWN
        for (let x = 1; x < GRID_SIZE - 1; x++) {
            edgePositions.push({ x, y: GRID_SIZE - 2, directions: [{ dx: 0, dy: 1 }, { dx: 1, dy: 1 }, { dx: -1, dy: 1 }] });
        }

        // Left edge (x=0 or x=1): place prefixes pointing LEFT
        for (let y = 1; y < GRID_SIZE - 1; y++) {
            edgePositions.push({ x: 1, y, directions: [{ dx: -1, dy: 0 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }] });
        }

        // Right edge (x=GRID_SIZE-1 or x=GRID_SIZE-2): place prefixes pointing RIGHT
        for (let y = 1; y < GRID_SIZE - 1; y++) {
            edgePositions.push({ x: GRID_SIZE - 2, y, directions: [{ dx: 1, dy: 0 }, { dx: 1, dy: 1 }, { dx: 1, dy: -1 }] });
        }

        // Shuffle edge positions
        edgePositions.sort(() => Math.random() - 0.5);

        var done = false;

        // Try to place the prefix
        for (const pos of edgePositions) {
            // Shuffle directions for this position
            const shuffledDirs = [...pos.directions].sort(() => Math.random() - 0.5);

            for (const dir of shuffledDirs) {
                const x1 = pos.x;
                const y1 = pos.y;
                const x2 = pos.x + dir.dx;
                const y2 = pos.y + dir.dy;

                // Both positions must be within the grid
                if (x2 < 0 || x2 >= GRID_SIZE || y2 < 0 || y2 >= GRID_SIZE) continue;

                const idx1 = y1 * GRID_SIZE + x1;
                const idx2 = y2 * GRID_SIZE + x2;

                // Check if both cells are empty
                if (grid[idx1] === null && grid[idx2] === null) {
                    // Place the prefix
                    grid[idx1] = prefix[0];
                    grid[idx2] = prefix[1];
                    done = true;
                    //console.log("Placed prefix: " + prefix + " at " + x1 + "," + y1 + " and " + x2 + "," + y2);
                    break;
                }
            }

            if (done) break;
        }
    }
}

// Input Handling
function handleInputStart(e) {
    // Force panning if shift key is held or multi-touch (2+ fingers)
    const forcePan = e.shiftKey || (e.touches && e.touches.length >= 2);

    if (!forcePan && e.target.classList.contains('cell') && !e.target.classList.contains('used')) {
        isSelecting = true;
        selectionStartCell = e.target;
        updateSelection(e.target, e.clientX, e.clientY);
        e.preventDefault();
    } else {
        isPanning = true;

        // Clear any existing selection when starting to pan
        clearSelection();

        // Default to single touch/mouse
        let clientX = e.clientX || (e.touches && e.touches[0].clientX);
        let clientY = e.clientY || (e.touches && e.touches[0].clientY);

        // For pinch-to-zoom: track initial distance and center
        if (e.touches && e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
            startScale = scale;

            // Use center of pinch for panning
            clientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            clientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

            // Track initial center position
            lastPinchCenterX = clientX;
            lastPinchCenterY = clientY;
        }

        startPanX = clientX - panX;
        startPanY = clientY - panY;

        gameContainer.style.cursor = 'grabbing';
    }
}

function handleInputMove(e) {
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    if (isPanning) {
        // Handle pinch-to-zoom with 2 touches
        if (e.touches && e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const currentDistance = Math.sqrt(dx * dx + dy * dy);

            // Calculate center point between the two touches
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

            // Calculate how much the center moved since last frame
            const deltaCenterX = centerX - lastPinchCenterX;
            const deltaCenterY = centerY - lastPinchCenterY;

            // Apply panning based on center movement
            panX += deltaCenterX;
            panY += deltaCenterY;

            // Apply zoom around current center position
            if (initialPinchDistance > 0) {
                const zoomFactor = currentDistance / initialPinchDistance;
                const newScale = startScale * zoomFactor;

                // applyZoom will keep the world point under centerX/centerY anchored
                applyZoom(newScale, centerX, centerY);
            }

            // Remember current center for next frame
            lastPinchCenterX = centerX;
            lastPinchCenterY = centerY;

            e.preventDefault();
        } else {
            // Regular panning
            panX = clientX - startPanX;
            panY = clientY - startPanY;
            updateWorldTransform();
            // Prevent scrolling on touch devices during panning
            if (e.touches) e.preventDefault();
        }
    } else if (isSelecting) {
        const target = document.elementFromPoint(clientX, clientY);
        // Update selection if over a valid cell, otherwise just update drag line to mouse
        if (target && target.classList.contains('cell') && !target.classList.contains('used')) {
            updateSelection(target, clientX, clientY);
        } else {
            updateDragLine(clientX, clientY);
        }
    }
}

function handleInputEnd() {
    if (isSelecting) {
        checkWord();
        clearSelection();
    }
    isPanning = false;
    isSelecting = false;
    initialPinchDistance = 0; // Reset pinch distance
    gameContainer.style.cursor = 'grab';
}

function handleWheel(e) {
    e.preventDefault();

    // Determine zoom direction
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = scale * zoomDelta;

    // Zoom around mouse position
    applyZoom(newScale, e.clientX, e.clientY);
}

function applyZoom(newScale, centerX, centerY) {
    // Clamp scale between 0.25x and 4x
    newScale = Math.max(0.25, Math.min(4, newScale));

    // Get container center in client coordinates
    const containerRect = gameContainer.getBoundingClientRect();
    const ox = containerRect.left + containerRect.width / 2;
    const oy = containerRect.top + containerRect.height / 2;

    // Calculate the world position under the cursor before zoom
    // panX/panY are translations relative to the center (ox, oy)
    const worldX = (centerX - ox - panX) / scale;
    const worldY = (centerY - oy - panY) / scale;

    // Update scale
    scale = newScale;

    // Adjust pan to keep the same world position under the cursor
    panX = centerX - ox - worldX * scale;
    panY = centerY - oy - worldY * scale;

    updateWorldTransform();
}

function updateWorldTransform() {
    world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
}

function updateSelection(endCell, mouseX, mouseY) {
    const startGx = parseInt(selectionStartCell.dataset.gx);
    const startGy = parseInt(selectionStartCell.dataset.gy);
    const endGx = parseInt(endCell.dataset.gx);
    const endGy = parseInt(endCell.dataset.gy);

    // Clear previous
    currentSelection.forEach(c => c.classList.remove('selected'));
    currentSelection = [];

    const dx = endGx - startGx;
    const dy = endGy - startGy;

    // Check for valid line
    if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) {
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
        const stepY = dy === 0 ? 0 : dy / Math.abs(dy);

        for (let i = 0; i <= steps; i++) {
            const gx = startGx + i * stepX;
            const gy = startGy + i * stepY;
            const cell = chunks[`${gx},${gy}`];
            if (cell && !cell.classList.contains('used')) { // "Feature": by finding a word, you can skip words across it
                cell.classList.add('selected');
                currentSelection.push(cell);
            }
        }

        // Snap drag line to center of end cell
        const rect = endCell.getBoundingClientRect();
        updateDragLine(rect.left + rect.width / 2, rect.top + rect.height / 2);
    } else {
        // If invalid, just follow mouse
        updateDragLine(mouseX, mouseY);
    }
}

function updateDragLine(targetX, targetY) {
    if (!selectionStartCell) {
        dragLine.setAttribute('d', '');
        return;
    }
    const startRect = selectionStartCell.getBoundingClientRect();
    const startX = startRect.left + startRect.width / 2;
    const startY = startRect.top + startRect.height / 2;

    dragLine.setAttribute('d', `M${startX},${startY} L${targetX},${targetY}`);
}

function clearSelection() {
    currentSelection.forEach(c => c.classList.remove('selected'));
    currentSelection = [];
    selectionStartCell = null;
    dragLine.setAttribute('d', '');
}

function checkWord() {
    const word = currentSelection.map(c => c.textContent).join('');
    if (word.length >= 4 && VALIDATION_DICT.has(word)) {
        currentSelection.forEach(c => {
            c.classList.remove('selected');
            c.classList.add('found');
            c.classList.add('used'); // Mark as used
        });

        if (isSpeedMode) {
            // Speed mode scoring
            const points = calculateSpeedModePoints(word.length);
            speedModeScore += points;
            const speedScoreEl = document.getElementById('speed-score');
            if (speedScoreEl) {
                speedScoreEl.textContent = speedModeScore;
            }
            showMessage(`${word} (+${points})`, '#4caf50');
            expandWorld();
        } else {
            // Normal mode
            foundWordsCount++;
            foundLettersCount += word.length;
            wordCountEl.textContent = foundWordsCount;
            avgLenEl.textContent = (foundLettersCount / foundWordsCount).toFixed(1);

            // Check if we have a definition for this word
            let message;
            if (typeof WORD_DEFINITIONS !== 'undefined' && WORD_DEFINITIONS[word.toLowerCase()]) {
                message = `${word}: ${WORD_DEFINITIONS[word.toLowerCase()]}`;
            } else if (typeof WORD_DEFINITIONS !== 'undefined' && word[word.length - 1] === 'S' && WORD_DEFINITIONS[word.slice(0, -1).toLowerCase()]) {
                message = `${word}: ${WORD_DEFINITIONS[word.slice(0, -1).toLowerCase()]}`;
            } else {
                message = `Found: ${word}!`;
            }

            // Truncate to 250 characters if needed
            if (message.length > 250) {
                message = message.substring(0, 250) + '...';
            }
            showMessage(message, '#4caf50');
            expandWorld();

            // Save game state after finding a word
            saveGameState();
        }
    } else if (word.length > 0 && word.length < 4) {
        showMessage('Words must be at least 4 letters long', '#e94560');
    } else if (word.length >= 4) {
        showMessage(`${word} invalid`, '#e94560');
    }
}

function showMessage(msg, color = 'pink') {
    messageArea.textContent = msg;
    messageArea.style.color = color;
    messageArea.classList.add('visible');
    setTimeout(() => messageArea.classList.remove('visible'), 2000);
}

function expandWorld() {
    const existingKeys = Array.from(occupiedChunks);
    const sourceKey = existingKeys[Math.floor(Math.random() * existingKeys.length)];
    const [sx, sy] = sourceKey.split(',').map(Number);

    const neighbors = [
        { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
    ];

    const available = [];
    neighbors.forEach(n => {
        const nx = sx + n.dx;
        const ny = sy + n.dy;
        if (!occupiedChunks.has(`${nx},${ny}`)) {
            available.push({ x: nx, y: ny, dir: n });
        }
    });

    if (available.length > 0) {
        const target = available[Math.floor(Math.random() * available.length)];
        createChunk(target.x, target.y, sx, sy, target.dir);

        // Don't auto-pan in speed mode
        if (!isSpeedMode) {
            panToChunk(target.x, target.y);
        }
    } else {
        expandWorld();
    }
}

function placeCrossChunkWordInGrid(grid, cx, cy, sx, sy, dir) {
    // Determine the edge cells in the old chunk adjacent to the new chunk
    const edgePositions = [];

    if (dir.dx === 1) { // New chunk to the right
        for (let ly = 0; ly < GRID_SIZE; ly++) {
            edgePositions.push({
                gx: sx * GRID_SIZE + GRID_SIZE - 1,
                gy: sy * GRID_SIZE + ly,
                primaryDir: { dx: 1, dy: 0 }  // Words must go right
            });
        }
    } else if (dir.dx === -1) { // New chunk to the left
        for (let ly = 0; ly < GRID_SIZE; ly++) {
            edgePositions.push({
                gx: sx * GRID_SIZE,
                gy: sy * GRID_SIZE + ly,
                primaryDir: { dx: -1, dy: 0 }  // Words must go left
            });
        }
    } else if (dir.dy === 1) { // New chunk below
        for (let lx = 0; lx < GRID_SIZE; lx++) {
            edgePositions.push({
                gx: sx * GRID_SIZE + lx,
                gy: sy * GRID_SIZE + GRID_SIZE - 1,
                primaryDir: { dx: 0, dy: 1 }  // Words must go down
            });
        }
    } else if (dir.dy === -1) { // New chunk above
        for (let lx = 0; lx < GRID_SIZE; lx++) {
            edgePositions.push({
                gx: sx * GRID_SIZE + lx,
                gy: sy * GRID_SIZE,
                primaryDir: { dx: 0, dy: -1 }  // Words must go up
            });
        }
    }

    // Shuffle edge positions for variety
    edgePositions.sort(() => Math.random() - 0.5);

    // Try each edge position
    for (const edgePos of edgePositions) {
        // Try the primary direction and diagonals that cross into the new chunk
        const tryDirections = [edgePos.primaryDir];

        // Add diagonal directions if they make sense
        if (Math.abs(edgePos.primaryDir.dx) === 1) {
            tryDirections.push({ dx: edgePos.primaryDir.dx, dy: 1 });
            tryDirections.push({ dx: edgePos.primaryDir.dx, dy: -1 });
        } else if (Math.abs(edgePos.primaryDir.dy) === 1) {
            tryDirections.push({ dx: 1, dy: edgePos.primaryDir.dy });
            tryDirections.push({ dx: -1, dy: edgePos.primaryDir.dy });
        }

        for (const direction of tryDirections) {
            // Try placing words starting 1 cell before the edge (so 2 letters in old chunk)
            const startGx = edgePos.gx - direction.dx;
            const startGy = edgePos.gy - direction.dy;

            // Read the 2-letter prefix from the old chunk
            const cell1 = chunks[`${startGx},${startGy}`];
            const cell2 = chunks[`${edgePos.gx},${edgePos.gy}`];

            if (!cell1 || !cell2) continue;
            if (cell1.classList.contains('used') || cell2.classList.contains('used')) continue;

            const prefix = cell1.textContent + cell2.textContent;
            const candidateWords = prefixMap[prefix];

            if (!candidateWords || candidateWords.length === 0) continue;

            // Shuffle candidates for variety
            const shuffledWords = [...candidateWords].sort(() => Math.random() - 0.5);

            // Try each candidate word
            for (const word of shuffledWords) {
                if (tryPlaceCrossChunkWordInGrid(grid, cx, cy, sx, sy, word, startGx, startGy, direction.dx, direction.dy)) {
                    //console.log(`Cross-chunk word placed: ${word} at (${startGx},${startGy}) dir(${direction.dx},${direction.dy})`);
                    return true;
                }
            }
        }
    }

    return false;
}

function tryPlaceCrossChunkWordInGrid(grid, cx, cy, sx, sy, word, startGx, startGy, stepX, stepY) {
    // 1. Validate
    for (let i = 0; i < word.length; i++) {
        const gx = startGx + i * stepX;
        const gy = startGy + i * stepY;

        // Determine which chunk this cell belongs to
        const cellCx = Math.floor(gx / GRID_SIZE);
        const cellCy = Math.floor(gy / GRID_SIZE);

        if (cellCx === sx && cellCy === sy) {
            // In Source Chunk - check existing
            const cell = chunks[`${gx},${gy}`];
            if (!cell || cell.textContent !== word[i]) return false;
        } else if (cellCx === cx && cellCy === cy) {
            // In Target Chunk - check grid
            // Convert global to local
            const lx = gx - cx * GRID_SIZE;
            const ly = gy - cy * GRID_SIZE;
            const idx = ly * GRID_SIZE + lx;
            if (grid[idx] !== null && grid[idx] !== word[i]) return false;
        } else {
            // In some other chunk (or out of bounds?)
            return false;
        }
    }

    // 2. Place (only in grid)
    for (let i = 0; i < word.length; i++) {
        const gx = startGx + i * stepX;
        const gy = startGy + i * stepY;
        const cellCx = Math.floor(gx / GRID_SIZE);
        const cellCy = Math.floor(gy / GRID_SIZE);

        if (cellCx === cx && cellCy === cy) {
            const lx = gx - cx * GRID_SIZE;
            const ly = gy - cy * GRID_SIZE;
            const idx = ly * GRID_SIZE + lx;
            grid[idx] = word[i];
        }
    }
    return true;
}

function panToChunk(cx, cy) {
    const chunkWorldX = (cx * CHUNK_WIDTH_PX) + (CHUNK_WIDTH_PX / 2);
    const chunkWorldY = (cy * CHUNK_HEIGHT_PX) + (CHUNK_HEIGHT_PX / 2);

    // Target pan must account for scale to keep the chunk centered
    const targetPanX = -chunkWorldX * scale;
    const targetPanY = -chunkWorldY * scale;

    const startX = panX;
    const startY = panY;
    const startTime = performance.now();
    const duration = 1000;

    function animate(time) {
        const elapsed = time - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);

        panX = startX + (targetPanX - startX) * ease;
        panY = startY + (targetPanY - startY) * ease;
        updateWorldTransform();

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }
    requestAnimationFrame(animate);
}

// Speed Mode Functions
function calculateSpeedModePoints(wordLength) {
    if (wordLength === 4) return 1;
    if (wordLength === 5) return 2;
    if (wordLength === 6) return 4;
    if (wordLength === 7) return 7;
    if (wordLength === 8) return 11;
    if (wordLength === 9) return 16;
    if (wordLength === 10) return 25;
    return 25 + wordLength; // 11+ letters
}

function toggleSpeedMode() {
    if (isSpeedMode) {
        exitSpeedMode();
    } else {
        enterSpeedMode();
    }
}

function enterSpeedMode() {
    // Save current game state using existing serialization
    savedGameState = serializeGameState();

    // Clear the world
    world.innerHTML = '';
    chunks = {};
    chunkElements = {};
    occupiedChunks.clear();

    // Create single grid at 0,0
    createChunk(0, 0);

    // Reset camera
    panX = -CHUNK_WIDTH_PX / 2;
    panY = -CHUNK_HEIGHT_PX / 2;
    //scale = 1.0;
    updateWorldTransform();

    // Enter speed mode
    isSpeedMode = true;
    speedModeScore = 0;
    speedModeTimeRemaining = 60;
    speedModeStartTime = Date.now();

    // Update UI
    document.body.classList.add('speed-mode-active');
    document.getElementById('normal-stats').classList.add('hidden');
    document.getElementById('speed-stats').classList.remove('hidden');
    document.getElementById('timer-border').classList.add('active');
    document.getElementById('speed-mode-btn').classList.add('hidden');

    // Start timer
    updateSpeedModeTimer();
}

function exitSpeedMode() {
    // Stop timer
    if (speedModeTimer) {
        cancelAnimationFrame(speedModeTimer);
        speedModeTimer = null;
    }

    // Update total score
    totalSpeedScore += speedModeScore;
    const totalScoreEl = document.getElementById('total-speed-score');
    if (totalScoreEl) {
        totalScoreEl.textContent = totalSpeedScore;
    }

    // Update max score
    if (speedModeScore > maxSpeedScore) {
        maxSpeedScore = speedModeScore;
        const maxScoreEl = document.getElementById('max-speed-score');
        if (maxScoreEl) {
            maxScoreEl.textContent = maxSpeedScore;
        }
    }

    // Show final score
    showMessage(`Speed Mode Complete! Score: ${speedModeScore}`, '#4caf50');

    // Restore game state using existing deserialization
    if (savedGameState) {
        restoreGameState(savedGameState, false);
        savedGameState = null;
    }

    // Exit speed mode
    isSpeedMode = false;
    document.body.classList.remove('speed-mode-active');
    document.getElementById('normal-stats').classList.remove('hidden');
    document.getElementById('speed-stats').classList.add('hidden');
    document.getElementById('timer-border').classList.remove('active');
    const speedBtn = document.getElementById('speed-mode-btn');
    speedBtn.classList.remove('hidden');

    // Save the updated total score
    saveGameState();
}

function updateSpeedModeTimer() {
    if (!isSpeedMode) return;

    const elapsed = (Date.now() - speedModeStartTime) / 1000;
    speedModeTimeRemaining = Math.max(0, 60 - elapsed);

    // Update timer border (radial sweep)
    const timerBorder = document.getElementById('timer-border');
    if (timerBorder) {
        const elapsed = (Date.now() - speedModeStartTime) / 1000;
        const progress = Math.min(1, elapsed / 60);
        timerBorder.style.setProperty('--timer-progress', progress);
    }

    // Check if time is up
    if (speedModeTimeRemaining <= 0) {
        exitSpeedMode();
        return;
    }

    // Continue timer
    speedModeTimer = requestAnimationFrame(updateSpeedModeTimer);
}

function updateScoreDisplay() {
    wordCountEl.textContent = foundWordsCount;
    avgLenEl.textContent = foundWordsCount > 0 ? (foundLettersCount / foundWordsCount).toFixed(1) : 0;
}
