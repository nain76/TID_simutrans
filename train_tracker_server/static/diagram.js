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
let companyFilter = '';
let lineSearchFilter = '';
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
let zoomLevel = 1.0;
let panOffset = { x: 0, y: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };

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

    // Company filter
    document.getElementById('filter-company').addEventListener('change', (e) => {
        companyFilter = e.target.value;
        updateLineSelector();
        renderDiagram();
    });

    // Line search filter
    document.getElementById('search-line').addEventListener('input', (e) => {
        lineSearchFilter = e.target.value.toLowerCase();
        updateLineSelector();
    });

    // Mouse wheel zoom
    const svgElement = document.getElementById('railroad-diagram');
    svgElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        zoomLevel = Math.max(0.5, Math.min(3.0, zoomLevel + delta));
        applyTransform();
    });

    // Mouse pan (drag)
    svgElement.addEventListener('mousedown', (e) => {
        // Only pan with left mouse button
        if (e.button === 0) {
            e.preventDefault(); // Prevent text selection during drag
            isPanning = true;
            panStart = { x: e.clientX, y: e.clientY };
            svgElement.style.cursor = 'grabbing';
        }
    });

    svgElement.addEventListener('mousemove', (e) => {
        if (isPanning) {
            const dx = (e.clientX - panStart.x) / zoomLevel;
            const dy = (e.clientY - panStart.y) / zoomLevel;
            panOffset.x += dx;
            panOffset.y += dy;
            panStart = { x: e.clientX, y: e.clientY };
            applyTransform();
        }
    });

    svgElement.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            isPanning = false;
            svgElement.style.cursor = 'grab';
        }
    });

    svgElement.addEventListener('mouseleave', () => {
        isPanning = false;
        svgElement.style.cursor = 'grab';
    });

    // Set initial cursor
    svgElement.style.cursor = 'grab';
}

/**
 * Zoom in
 */
function zoomIn() {
    zoomLevel = Math.min(3.0, zoomLevel + 0.2);
    applyTransform();
}

/**
 * Zoom out
 */
function zoomOut() {
    zoomLevel = Math.max(0.5, zoomLevel - 0.2);
    applyTransform();
}

/**
 * Reset zoom to 100% and center view
 */
function resetZoom() {
    zoomLevel = 1.0;
    panOffset = { x: 0, y: 0 };
    applyTransform();
}

/**
 * Apply zoom and pan transform to SVG
 */
function applyTransform() {
    const content = document.getElementById('diagram-content');

    if (content) {
        content.setAttribute('transform', `translate(${panOffset.x}, ${panOffset.y}) scale(${zoomLevel})`);
    }

    // Update zoom level display
    document.getElementById('zoom-level').textContent = `${Math.round(zoomLevel * 100)}%`;
}

/**
 * Load station data from API
 */
async function loadStationData() {
    try {
        console.log('[Diagram] Fetching station data from', API_URL);
        const response = await fetch(API_URL);
        console.log('[Diagram] Response status:', response.status);

        const data = await response.json();
        console.log('[Diagram] Station data received:', data);

        if (data.error) {
            console.error('[Diagram] API returned error:', data.error);
            updateConnectionStatus(false, data.error);
            return;
        }

        if (data.lines && data.lines.length > 0) {
            console.log('[Diagram] Found', data.lines.length, 'lines');
            stationData = data;

            // On initial load, select all lines
            if (selectedLines.size === 0) {
                stationData.lines.forEach(line => selectedLines.add(line.name));
                console.log('[Diagram] Selected all lines:', selectedLines.size);
            }

            updateCompanyFilter();
            updateLineSelector();
            renderDiagram();
            updateConnectionStatus(true);
        } else {
            console.warn('[Diagram] No station data available in response');
            updateConnectionStatus(false, 'No station data');
        }
    } catch (error) {
        console.error('[Diagram] Error loading station data:', error);
        updateConnectionStatus(false, 'Error loading data: ' + error.message);
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
            // Don't call renderDiagram() here - it's called by the caller
        }
    } catch (error) {
        console.error('Error loading train data:', error);
    }
}

/**
 * Update company filter dropdown
 */
function updateCompanyFilter() {
    const filterSelect = document.getElementById('filter-company');

    if (!stationData || !stationData.lines || stationData.lines.length === 0) {
        return;
    }

    // Extract unique companies
    const companies = new Set();
    stationData.lines.forEach(line => {
        if (line.company) {
            companies.add(line.company);
        }
    });

    // Build options
    const currentValue = filterSelect.value;
    let options = '<option value="">全ての会社</option>';

    Array.from(companies).sort().forEach(company => {
        const selected = company === currentValue ? 'selected' : '';
        options += `<option value="${company}" ${selected}>${company}</option>`;
    });

    filterSelect.innerHTML = options;
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

    // Apply filters
    const filteredLines = stationData.lines.filter(line => {
        // Company filter
        if (companyFilter && line.company !== companyFilter) {
            return false;
        }

        // Line name search filter
        if (lineSearchFilter && !line.name.toLowerCase().includes(lineSearchFilter)) {
            return false;
        }

        return true;
    });

    if (filteredLines.length === 0) {
        selector.innerHTML = '<p class="loading-text">該当する路線がありません</p>';
        return;
    }

    // Build line items
    const lineItems = filteredLines.map((line, index) => {
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

    // Convert coordinates
    const x = (gameX - bounds.minX) * scale;
    const y = (gameY - bounds.minY) * scale;

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

    // Collect all unique stations (avoid duplicate rendering)
    const uniqueStations = new Map();

    // Collect all unique track segments (avoid duplicate track rendering)
    const uniqueSegments = new Map();

    // Store all lines' SVG stations for later use
    const linesData = [];

    linesToRender.forEach((line, lineIndex) => {
        const color = LINE_COLORS[lineIndex % LINE_COLORS.length];
        const stations = line.stations;

        if (!stations || stations.length === 0) return;

        // Deduplicate stations within this line first (handle circular routes)
        const uniqueLineStations = new Map();
        const deduplicatedStations = [];

        stations.forEach(station => {
            const key = `${Math.round(station.x)},${Math.round(station.y)}`;
            if (!uniqueLineStations.has(key)) {
                uniqueLineStations.set(key, station);
                deduplicatedStations.push(station);
            }
        });

        totalStations += deduplicatedStations.length;

        // Convert station coordinates
        const svgStations = deduplicatedStations.map(station => {
            const pos = gameToSVG(station.x, station.y, bounds);
            const svgStation = {
                ...station,
                svgX: pos.x,
                svgY: pos.y
            };

            // Track unique stations globally (across all lines)
            const key = `${Math.round(station.x)},${Math.round(station.y)}`;
            if (!uniqueStations.has(key)) {
                uniqueStations.set(key, svgStation);
            }

            return svgStation;
        });

        // Extract track segments from this line
        for (let i = 0; i < svgStations.length - 1; i++) {
            const s1 = svgStations[i];
            const s2 = svgStations[i + 1];

            // Skip if same station (shouldn't happen after dedup, but be safe)
            if (Math.round(s1.x) === Math.round(s2.x) && Math.round(s1.y) === Math.round(s2.y)) {
                continue;
            }

            // Create a unique key for this segment (order-independent, using game coordinates)
            const key1 = `${Math.round(s1.x)},${Math.round(s1.y)}`;
            const key2 = `${Math.round(s2.x)},${Math.round(s2.y)}`;
            const segmentKey = key1 < key2 ? `${key1}-${key2}` : `${key2}-${key1}`;

            // Store segment if not already stored
            if (!uniqueSegments.has(segmentKey)) {
                uniqueSegments.set(segmentKey, {
                    s1: s1,
                    s2: s2,
                    color: color
                });
            }
        }

        // Store line data for train rendering
        linesData.push({
            line: line,
            svgStations: svgStations,
            color: color
        });
    });

    // Draw all unique track segments once
    uniqueSegments.forEach(segment => {
        svgContent += `<line x1="${segment.s1.svgX}" y1="${segment.s1.svgY}" x2="${segment.s2.svgX}" y2="${segment.s2.svgY}" class="rail-line" stroke="${segment.color}" stroke-width="2" />`;
    });

    // Draw all unique stations once (after all tracks, before trains)
    uniqueStations.forEach(station => {
        svgContent += renderStation(station, '#2c3e50');
    });

    // Collect all unique trains (avoid duplicate rendering)
    const uniqueTrains = new Map();

    // Draw trains for each line (drawn last so they appear on top)
    linesData.forEach(lineData => {
        if (trainData && trainData.trains) {
            const lineTrains = trainData.trains.filter(train => train.line === lineData.line.name);
            lineTrains.forEach(train => {
                // Use train name as unique key to prevent duplicates
                if (!uniqueTrains.has(train.name)) {
                    const trainSvg = renderTrain(train, bounds, lineData.color, lineData.svgStations);
                    if (trainSvg) {
                        uniqueTrains.set(train.name, true);
                        visibleTrains++;
                        svgContent += trainSvg;
                    }
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
 * Find nearest point on line segment to a given point
 */
function nearestPointOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) return { x: x1, y: y1 };

    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    return {
        x: x1 + t * dx,
        y: y1 + t * dy
    };
}

/**
 * Find nearest point on track (any segment of the line)
 * Returns both the point and the segment direction
 */
function snapToTrack(trainPos, svgStations) {
    if (!svgStations || svgStations.length < 2) {
        return { point: trainPos, angle: 0 };
    }

    let minDist = Infinity;
    let nearest = trainPos;
    let segmentAngle = 0;

    // Check all segments of the track
    for (let i = 0; i < svgStations.length - 1; i++) {
        const s1 = svgStations[i];
        const s2 = svgStations[i + 1];

        const point = nearestPointOnSegment(trainPos.x, trainPos.y, s1.svgX, s1.svgY, s2.svgX, s2.svgY);
        const dist = Math.sqrt(Math.pow(point.x - trainPos.x, 2) + Math.pow(point.y - trainPos.y, 2));

        if (dist < minDist) {
            minDist = dist;
            nearest = point;
            // Calculate angle of this segment (in degrees)
            segmentAngle = Math.atan2(s2.svgY - s1.svgY, s2.svgX - s1.svgX) * 180 / Math.PI;
        }
    }

    return { point: nearest, angle: segmentAngle };
}

/**
 * Render train at actual game position, snapped to track
 * Trains are rendered as directional triangles
 */
function renderTrain(train, bounds, color, svgStations) {
    if (!train.position) return '';

    // Convert train position to SVG coordinates
    let trainSvgPos = gameToSVG(train.position.x, train.position.y, bounds);

    // Snap to nearest point on track and get direction
    const snapResult = snapToTrack(trainSvgPos, svgStations);
    const pos = snapResult.point;
    const angle = snapResult.angle;

    const trainColor = train.is_loading ? '#fbbf24' : '#ef4444';
    const pulseClass = train.is_loading ? 'loading-train' : '';

    // Define triangle pointing to the right (will be rotated based on direction)
    // Base size: 24px wide, 16px tall
    const triangleSize = 16;
    const trianglePoints = `0,-${triangleSize/2} ${triangleSize*1.5},0 0,${triangleSize/2}`;

    let svg = `
        <g class="train-icon ${pulseClass}" transform="translate(${pos.x},${pos.y}) rotate(${angle})">
            <polygon points="${trianglePoints}" fill="${trainColor}"
                    stroke="#fff" stroke-width="2" />
        </g>
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
