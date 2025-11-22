
const GRID_SIZE = 10;
const CELL_SIZE = 40;
const CHUNK_WIDTH_PX = (GRID_SIZE * CELL_SIZE);
const CHUNK_HEIGHT_PX = CHUNK_WIDTH_PX;

const gameContainer = document.getElementById('game-container');
const world = document.getElementById('world');
const wordCountEl = document.getElementById('word-count');
const letterCountEl = document.getElementById('letter-count');
const messageArea = document.getElementById('message-area');
const dragLine = document.getElementById('drag-line');

let placementWords = [];
let chunks = {}; // Key: "gx,gy", Value: Cell Element
let chunkElements = {}; // Key: "cx,cy", Value: Chunk Element
let occupiedChunks = new Set(); // Key: "cx,cy"

let isPanning = false;
let isSelecting = false;
let startPanX, startPanY;
let panX = 0, panY = 0;
let selectionStartCell = null;
let currentSelection = [];
let foundWordsCount = 0;
let foundLettersCount = 0;

// Initialize
init();

function init() {
    processDictionaries();

    // Center the world initially
    panX = -CHUNK_WIDTH_PX / 2;
    panY = -CHUNK_HEIGHT_PX / 2;
    updateWorldTransform();

    // Create initial chunk at 0,0
    createChunk(0, 0);

    // Event Listeners
    gameContainer.addEventListener('mousedown', handleInputStart);
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('mouseup', handleInputEnd);

    // Touch support
    gameContainer.addEventListener('touchstart', (e) => handleInputStart(e.touches[0]));
    window.addEventListener('touchmove', (e) => handleInputMove(e.touches[0]));
    window.addEventListener('touchend', handleInputEnd);
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

    // Validation Dictionary is already a Set in VALIDATION_DICT (from all_words.js)
    if (typeof VALIDATION_DICT === 'undefined') {
        console.error("Validation dictionary not loaded!");
        window.VALIDATION_DICT = new Set(placementWords);
    }
}

function createChunk(cx, cy) {
    const key = `${cx},${cy}`;
    if (occupiedChunks.has(key)) return;

    const chunkEl = document.createElement('div');
    chunkEl.className = 'grid-chunk newly-added';
    chunkEl.style.left = `${cx * CHUNK_WIDTH_PX}px`;
    chunkEl.style.top = `${cy * CHUNK_HEIGHT_PX}px`;
    chunkEl.dataset.cx = cx;
    chunkEl.dataset.cy = cy;

    const gridData = generateGridData(cx, cy);

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

    setTimeout(() => chunkEl.classList.remove('newly-added'), 600);
}

function generateGridData(cx, cy) {
    const grid = new Array(GRID_SIZE * GRID_SIZE).fill(null);
    const wordsToPlace = 3 + Math.floor(Math.random() * 3);

    for (let i = 0; i < wordsToPlace; i++) {
        if (placementWords.length > 0) {
            const word = placementWords[Math.floor(Math.random() * placementWords.length)];
            placeWord(grid, word);
        }
    }

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
        startPanX = (e.clientX || (e.touches && e.touches[0].clientX)) - panX;
        startPanY = (e.clientY || (e.touches && e.touches[0].clientY)) - panY;
        gameContainer.style.cursor = 'grabbing';
    }
}

function handleInputMove(e) {
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    if (isPanning) {
        panX = clientX - startPanX;
        panY = clientY - startPanY;
        updateWorldTransform();
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
    gameContainer.style.cursor = 'grab';
}

function updateWorldTransform() {
    world.style.transform = `translate(${panX}px, ${panY}px)`;
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
            if (cell && !cell.classList.contains('used')) {
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
        foundWordsCount++;
        foundLettersCount += word.length;
        wordCountEl.textContent = foundWordsCount;
        letterCountEl.textContent = foundLettersCount;

        currentSelection.forEach(c => {
            c.classList.remove('selected');
            c.classList.add('found');
            c.classList.add('used'); // Mark as used
        });

        showMessage(`Found: ${word}!`);
        expandWorld();
    }
}

function showMessage(msg) {
    messageArea.textContent = msg;
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
        createChunk(target.x, target.y);

        // 30% chance to place a cross-chunk word, try up to 25 times
        if (Math.random() < 0.3) {
            for (let attempt = 0; attempt < 25; attempt++) {
                if (attemptCrossChunkPlacement(sx, sy, target.x, target.y, target.dir)) {
                    break; // Success, stop trying
                }
            }
        }

        panToChunk(target.x, target.y);
    } else {
        expandWorld();
    }
}

function attemptCrossChunkPlacement(sx, sy, nx, ny, dir) {
    // Pick a random word
    if (placementWords.length === 0) return false;
    const word = placementWords[Math.floor(Math.random() * placementWords.length)];

    // Determine placement direction and start position
    // We want at least 2 letters in the new chunk
    const minInNew = 2;
    const maxStart = word.length - minInNew;

    let startGx, startGy;
    let stepX = dir.dx;
    let stepY = dir.dy;

    // Calculate starting position based on direction
    if (dir.dx === 1) { // New chunk to the right
        const offset = Math.floor(Math.random() * maxStart);
        startGx = sx * GRID_SIZE + GRID_SIZE - offset - 1;
        startGy = sy * GRID_SIZE + Math.floor(Math.random() * GRID_SIZE);
    } else if (dir.dx === -1) { // New chunk to the left
        const offset = Math.floor(Math.random() * maxStart);
        startGx = sx * GRID_SIZE + offset;
        startGy = sy * GRID_SIZE + Math.floor(Math.random() * GRID_SIZE);
    } else if (dir.dy === 1) { // New chunk below
        const offset = Math.floor(Math.random() * maxStart);
        startGx = sx * GRID_SIZE + Math.floor(Math.random() * GRID_SIZE);
        startGy = sy * GRID_SIZE + GRID_SIZE - offset - 1;
    } else if (dir.dy === -1) { // New chunk above
        const offset = Math.floor(Math.random() * maxStart);
        startGx = sx * GRID_SIZE + Math.floor(Math.random() * GRID_SIZE);
        startGy = sy * GRID_SIZE + offset;
    } else {
        return false;
    }

    // Try to place the word, checking for conflicts and used letters
    for (let i = 0; i < word.length; i++) {
        const gx = startGx + i * stepX;
        const gy = startGy + i * stepY;
        const key = `${gx},${gy}`;
        const cell = chunks[key];

        if (!cell) return false; // Cell doesn't exist
        if (cell.classList.contains('used')) return false; // Cell already used

        const existing = cell.textContent;
        if (existing && existing !== word[i]) return false; // Conflict
    }

    // Place the word
    for (let i = 0; i < word.length; i++) {
        const gx = startGx + i * stepX;
        const gy = startGy + i * stepY;
        const key = `${gx},${gy}`;
        const cell = chunks[key];
        cell.textContent = word[i];
    }

    console.log(`Cross-chunk word placed: ${word}`);
    return true;
}

function panToChunk(cx, cy) {
    const chunkWorldX = (cx * CHUNK_WIDTH_PX) + (CHUNK_WIDTH_PX / 2);
    const chunkWorldY = (cy * CHUNK_HEIGHT_PX) + (CHUNK_HEIGHT_PX / 2);

    const targetPanX = -chunkWorldX;
    const targetPanY = -chunkWorldY;

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
