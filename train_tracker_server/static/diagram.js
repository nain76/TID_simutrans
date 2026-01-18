/**
 * Railroad Diagram Viewer - Real Coordinate Based
 * Visualizes train positions using actual game coordinates
 */

// Configuration
const API_URL = '/api/stations';
const TRAINS_API_URL = '/api/trains';
const UPDATE_INTERVAL = 5000; // 5 seconds

// State
let stationData = null;
let trainData = null;
let selectedLines = new Set();
let displaySettings = {
    showStationNames: true,
    showTrainNames: true,
    showSpeeds: true
};

// Line colors (automatically assigned)
const LINE_COLORS = [
    '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#6366f1',
    '#84cc16', '#f43f5e', '#a855f7', '#22c55e', '#eab308'
];

// SVG viewport settings
let viewBox = { minX: 0, minY: 0, width: 1000, height: 600 };
let scale = 1;

/**
 * Initialize the diagram viewer
 */
async function init() {
    console.log('Initializing diagram viewer...');

    // Setup event listeners
    setupEventListeners();

    // Load initial data
    await Promise.all([
        loadStationData(),
        loadTrainData()
    ]);

    // Start auto-update
    setInterval(async () => {
        await loadTrainData();
        renderDiagram();
    }, UPDATE_INTERVAL);

    console.log('Diagram viewer initialized');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', async () => {
        await Promise.all([
            loadStationData(),
            loadTrainData()
        ]);
        renderDiagram();
    });

    // Display settings checkboxes
    document.getElementById('show-station-names').addEventListener('change', (e) => {
        displaySettings.showStationNames = e.target.checked;
        renderDiagram();
    });

    document.getElementById('show-train-names').addEventListener('change', (e) => {
        displaySettings.showTrainNames = e.target.checked;
        renderDiagram();
    });

    document.getElementById('show-speeds').addEventListener('change', (e) => {
        displaySettings.showSpeeds = e.target.checked;
        renderDiagram();
    });
}

/**
 * Load station data from API
 */
async function loadStationData() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();

        if (data.lines && data.lines.length > 0) {
            stationData = data;

            // On initial load, select all lines
            if (selectedLines.size === 0) {
                stationData.lines.forEach(line => selectedLines.add(line.name));
            }

            updateLineSelector();
            renderDiagram();
            updateConnectionStatus(true);
        } else {
            console.warn('No station data available');
            updateConnectionStatus(false, 'No station data');
        }
    } catch (error) {
        console.error('Error loading station data:', error);
        updateConnectionStatus(false, 'Error loading data');
    }
}

/**
 * Load train data from API
 */
async function loadTrainData() {
    try {
        const response = await fetch(TRAINS_API_URL);
        const data = await response.json();

        if (data.trains) {
            trainData = data;
            updateGameTime(data.game_time);
            updateLastUpdate();
            renderDiagram();
        }
    } catch (error) {
        console.error('Error loading train data:', error);
    }
}

/**
 * Update line selector in sidebar
 */
function updateLineSelector() {
    const selector = document.getElementById('line-selector');

    if (!stationData || !stationData.lines || stationData.lines.length === 0) {
        selector.innerHTML = '<p class="loading-text">路線データがありません</p>';
        return;
    }

    // Build line items
    const lineItems = stationData.lines.map((line, index) => {
        const color = LINE_COLORS[index % LINE_COLORS.length];
        const isChecked = selectedLines.has(line.name) ? 'checked' : '';

        return `
            <div class="line-item">
                <input type="checkbox" id="line-${index}" value="${line.name}" ${isChecked}
                       onchange="toggleLine('${line.name.replace(/'/g, "\\'")}')">
                <label for="line-${index}" class="line-name">${line.name}</label>
                <div class="line-color" style="background-color: ${color}"></div>
            </div>
        `;
    }).join('');

    selector.innerHTML = lineItems;
}

/**
 * Toggle line selection
 */
function toggleLine(lineName) {
    if (selectedLines.has(lineName)) {
        selectedLines.delete(lineName);
    } else {
        selectedLines.add(lineName);
    }
    renderDiagram();
}

/**
 * Select all lines
 */
function selectAllLines() {
    if (!stationData || !stationData.lines) return;
    selectedLines.clear();
    stationData.lines.forEach(line => selectedLines.add(line.name));
    updateLineSelector();
    renderDiagram();
}

/**
 * Deselect all lines
 */
function deselectAllLines() {
    selectedLines.clear();
    updateLineSelector();
    renderDiagram();
}

/**
 * Calculate bounds for all selected stations
 */
function calculateBounds(lines) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    lines.forEach(line => {
        line.stations.forEach(station => {
            minX = Math.min(minX, station.x);
            minY = Math.min(minY, station.y);
            maxX = Math.max(maxX, station.x);
            maxY = Math.max(maxY, station.y);
        });
    });

    // Add padding
    const padding = 50;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    return { minX, minY, maxX, maxY };
}

/**
 * Convert game coordinates to SVG coordinates
 */
function gameToSVG(gameX, gameY, bounds) {
    const svgWidth = 1200;
    const svgHeight = 800;

    // Calculate scale to fit
    const scaleX = svgWidth / (bounds.maxX - bounds.minX);
    const scaleY = svgHeight / (bounds.maxY - bounds.minY);
    scale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave margin

    // Convert coordinates (flip Y axis for SVG)
    const x = (gameX - bounds.minX) * scale;
    const y = (bounds.maxY - gameY) * scale; // Flip Y

    return { x, y };
}

/**
 * Render the railroad diagram
 */
function renderDiagram() {
    const svg = document.getElementById('diagram-content');

    if (!stationData || selectedLines.size === 0) {
        svg.innerHTML = `
            <text x="400" y="300" text-anchor="middle" class="no-data-message">
                路線を選択してください
            </text>
        `;
        updateStats(0, 0, 0);
        return;
    }

    // Filter selected lines
    const linesToRender = stationData.lines.filter(line => selectedLines.has(line.name));

    if (linesToRender.length === 0) {
        svg.innerHTML = `
            <text x="400" y="300" text-anchor="middle" class="no-data-message">
                路線を選択してください
            </text>
        `;
        updateStats(0, 0, 0);
        return;
    }

    // Calculate bounds
    const bounds = calculateBounds(linesToRender);

    // Update SVG viewBox
    const svgElement = document.getElementById('railroad-diagram');
    svgElement.setAttribute('viewBox', `0 0 1200 800`);

    // Render SVG
    let svgContent = '';
    let totalStations = 0;
    let visibleTrains = 0;

    linesToRender.forEach((line, lineIndex) => {
        const color = LINE_COLORS[lineIndex % LINE_COLORS.length];
        const stations = line.stations;

        if (!stations || stations.length === 0) return;

        totalStations += stations.length;

        // Convert station coordinates
        const svgStations = stations.map(station => {
            const pos = gameToSVG(station.x, station.y, bounds);
            return {
                ...station,
                svgX: pos.x,
                svgY: pos.y
            };
        });

        // Draw rail line connecting stations
        svgContent += renderRailLine(svgStations, color);

        // Draw stations
        svgStations.forEach(station => {
            svgContent += renderStation(station, color);
        });

        // Draw trains on this line
        if (trainData && trainData.trains) {
            const lineTrains = trainData.trains.filter(train => train.line === line.name);
            lineTrains.forEach(train => {
                const trainSvg = renderTrain(train, bounds, color);
                if (trainSvg) {
                    visibleTrains++;
                    svgContent += trainSvg;
                }
            });
        }
    });

    svg.innerHTML = svgContent;

    // Update stats
    updateStats(linesToRender.length, visibleTrains, totalStations);
}

/**
 * Render rail line (connecting lines between stations)
 */
function renderRailLine(stations, color) {
    if (stations.length < 2) return '';

    const points = stations.map(s => `${s.svgX},${s.svgY}`).join(' ');
    return `<polyline points="${points}" class="rail-line" stroke="${color}" stroke-width="2" fill="none" />`;
}

/**
 * Render station marker
 */
function renderStation(station, color) {
    let svg = `
        <circle cx="${station.svgX}" cy="${station.svgY}" r="5" class="station-circle"
                fill="${color}" stroke="#fff" stroke-width="2" />
    `;

    if (displaySettings.showStationNames) {
        svg += `
            <text x="${station.svgX}" y="${station.svgY - 10}" class="station-name"
                  text-anchor="middle" font-size="11" fill="#333">
                ${station.name}
            </text>
        `;
    }

    return svg;
}

/**
 * Render train at actual game position
 */
function renderTrain(train, bounds, color) {
    if (!train.position) return '';

    // Convert train position to SVG coordinates
    const pos = gameToSVG(train.position.x, train.position.y, bounds);

    const trainColor = train.is_loading ? '#fbbf24' : '#ef4444';
    const pulseClass = train.is_loading ? 'loading-train' : '';

    let svg = `
        <g class="train-icon ${pulseClass}">
            <circle cx="${pos.x}" cy="${pos.y}" r="6" fill="${trainColor}"
                    stroke="#fff" stroke-width="2" />
    `;

    let labelY = pos.y + 20;

    if (displaySettings.showTrainNames) {
        svg += `
            <text x="${pos.x}" y="${labelY}" class="train-label"
                  text-anchor="middle" font-size="10" fill="#000" font-weight="bold">
                ${train.name}
            </text>
        `;
        labelY += 12;
    }

    if (displaySettings.showSpeeds) {
        svg += `
            <text x="${pos.x}" y="${labelY}" class="speed-label"
                  text-anchor="middle" font-size="9" fill="#666">
                ${train.speed_kmh} km/h
            </text>
        `;
    }

    svg += '</g>';

    return svg;
}

/**
 * Update game time display
 */
function updateGameTime(gameTime) {
    if (!gameTime) return;

    const timeStr = `${gameTime.year}年 ${gameTime.month + 1}月`;
    document.getElementById('game-time').textContent = `ゲーム時刻: ${timeStr}`;
}

/**
 * Update last update timestamp
 */
function updateLastUpdate() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ja-JP');
    document.getElementById('last-update').textContent = `最終更新: ${timeStr}`;
}

/**
 * Update connection status
 */
function updateConnectionStatus(connected, message = '') {
    const statusEl = document.getElementById('connection-status');

    if (connected) {
        statusEl.textContent = '接続中';
        statusEl.className = 'status-connected';
    } else {
        statusEl.textContent = message || '切断';
        statusEl.className = 'status-disconnected';
    }
}

/**
 * Update statistics display
 */
function updateStats(lines, trains, stations) {
    document.getElementById('stat-lines').textContent = lines;
    document.getElementById('stat-trains').textContent = trains;
    document.getElementById('stat-stations').textContent = stations;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
