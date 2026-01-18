/**
 * Railroad Diagram Viewer
 * Visualizes train positions on a railroad network diagram
 */

// Configuration
const API_URL = '/api/stations';
const TRAINS_API_URL = '/api/trains';
const CONFIG_API_URL = '/api/line-config';
const UPDATE_INTERVAL = 5000; // 5 seconds

// State
let stationData = null;
let trainData = null;
let lineConfig = null;
let selectedLines = new Set();
let displaySettings = {
    showStationNames: true,
    showTrainNames: true,
    showSpeeds: true,
    autoLayout: true
};

// Line colors (automatically assigned)
const LINE_COLORS = [
    '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#6366f1',
    '#84cc16', '#f43f5e', '#a855f7', '#22c55e', '#eab308'
];

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
        loadTrainData(),
        loadLineConfig()
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

    document.getElementById('auto-layout').addEventListener('change', (e) => {
        displaySettings.autoLayout = e.target.checked;
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
 * Load manual line configuration (optional)
 */
async function loadLineConfig() {
    try {
        const response = await fetch(CONFIG_API_URL);
        if (response.ok) {
            lineConfig = await response.json();
        }
    } catch (error) {
        // Config is optional, so this is not an error
        console.log('No manual line configuration found (this is OK)');
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
                       onchange="toggleLine('${line.name}')">
                <label for="line-${index}" class="line-name">${line.name}</label>
                <div class="line-color" style="background-color: ${color}"></div>
            </div>
        `;
    }).join('');

    selector.innerHTML = lineItems;

    // If no lines selected, select all by default
    if (selectedLines.size === 0) {
        stationData.lines.forEach(line => selectedLines.add(line.name));
        updateLineSelector(); // Re-render to show checkboxes
    }
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

    // Calculate layout
    const layout = calculateLayout(linesToRender);

    // Render SVG
    let svgContent = '';
    let totalStations = 0;
    let visibleTrains = 0;

    linesToRender.forEach((line, lineIndex) => {
        const color = LINE_COLORS[lineIndex % LINE_COLORS.length];
        const stations = layout.lines[line.name];

        if (!stations || stations.length === 0) return;

        totalStations += stations.length;

        // Draw rail line
        svgContent += renderRailLine(stations, color);

        // Draw stations
        stations.forEach(station => {
            svgContent += renderStation(station, color);
        });

        // Draw trains on this line
        if (trainData && trainData.trains) {
            const lineTrains = trainData.trains.filter(train => train.line === line.name);
            lineTrains.forEach(train => {
                const trainSvg = renderTrain(train, stations, color);
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
 * Calculate layout for stations
 */
function calculateLayout(lines) {
    const layout = { lines: {} };
    const margin = 50;
    const lineSpacing = 150;
    const stationSpacing = 100;

    lines.forEach((line, lineIndex) => {
        const y = margin + (lineIndex * lineSpacing);
        const stations = line.stations || [];

        layout.lines[line.name] = stations.map((station, stationIndex) => {
            // Check for manual positioning
            let x, stationY;

            if (!displaySettings.autoLayout && lineConfig && lineConfig[line.name]) {
                const manualPos = lineConfig[line.name][station.name];
                if (manualPos) {
                    x = manualPos.x;
                    stationY = manualPos.y;
                } else {
                    x = margin + (stationIndex * stationSpacing);
                    stationY = y;
                }
            } else {
                // Auto layout
                x = margin + (stationIndex * stationSpacing);
                stationY = y;
            }

            return {
                name: station.name,
                x: x,
                y: stationY,
                gameX: station.x,
                gameY: station.y,
                gameZ: station.z
            };
        });
    });

    return layout;
}

/**
 * Render rail line (connecting lines between stations)
 */
function renderRailLine(stations, color) {
    if (stations.length < 2) return '';

    const points = stations.map(s => `${s.x},${s.y}`).join(' ');
    return `<polyline points="${points}" class="rail-line" stroke="${color}" />`;
}

/**
 * Render station marker
 */
function renderStation(station, color) {
    let svg = `
        <circle cx="${station.x}" cy="${station.y}" r="6" class="station-circle" fill="${color}" />
    `;

    if (displaySettings.showStationNames) {
        svg += `
            <text x="${station.x}" y="${station.y - 12}" class="station-name">
                ${station.name}
            </text>
        `;
    }

    return svg;
}

/**
 * Render train on the line
 */
function renderTrain(train, stations, color) {
    if (!train.position || stations.length === 0) return '';

    // Find closest station to train position
    const closestStation = findClosestStation(train.position, stations);
    if (!closestStation) return '';

    const loadingClass = train.is_loading ? 'loading-train' : '';
    const trainColor = train.is_loading ? '#fbbf24' : '#ef4444';

    let svg = `
        <g class="train-icon">
            <circle cx="${closestStation.x}" cy="${closestStation.y}" r="8" fill="${trainColor}" class="${loadingClass}" />
    `;

    if (displaySettings.showTrainNames) {
        svg += `
            <text x="${closestStation.x}" y="${closestStation.y + 25}" class="train-label">
                ${train.name}
            </text>
        `;
    }

    if (displaySettings.showSpeeds) {
        svg += `
            <text x="${closestStation.x}" y="${closestStation.y + 37}" class="speed-label">
                ${train.speed_kmh} km/h
            </text>
        `;
    }

    svg += '</g>';

    return svg;
}

/**
 * Find closest station to a train position
 */
function findClosestStation(trainPos, stations) {
    if (stations.length === 0) return null;

    let closest = stations[0];
    let minDistance = Infinity;

    stations.forEach(station => {
        const dx = trainPos.x - station.gameX;
        const dy = trainPos.y - station.gameY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < minDistance) {
            minDistance = distance;
            closest = station;
        }
    });

    return closest;
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
