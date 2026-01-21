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
    showTracks: true,
    showStationNames: true,
    showTrainNames: true,
    showSpeeds: true,
    trackColor: '#00ff00',
    trackOpacity: 1.0,
    useLineColorsForTracks: true,
    useLineColorsForTrains: true
};
let lineGroups = []; // Array of {name: string, lines: Set<string>}

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

// Line editing state
let segmentWaypoints = new Map(); // Map<segmentKey, [{x, y}]> - waypoints for each segment
let isDraggingWaypoint = false;
let draggedWaypoint = null; // {segmentKey, waypointIndex}
let snapDistance = 20; // Distance in pixels to snap to a station

/**
 * Initialize the diagram viewer
 */
async function init() {
    console.log('Initializing diagram viewer...');

    // Clear line groups (reset to default state)
    lineGroups = [];
    updateGroupsList();

    // Setup event listeners
    setupEventListeners();

    // Load initial data
    await Promise.all([
        loadStationData(),
        loadTrainData()
    ]);
    renderDiagram();

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
    document.getElementById('show-tracks').addEventListener('change', (e) => {
        displaySettings.showTracks = e.target.checked;
        renderDiagram();
    });

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

    // Track color settings
    document.getElementById('track-color').addEventListener('input', (e) => {
        displaySettings.trackColor = e.target.value;
        // Automatically disable line colors for tracks when custom color is selected
        displaySettings.useLineColorsForTracks = false;
        document.getElementById('use-line-colors-for-tracks').checked = false;
        renderDiagram();
    });

    document.getElementById('track-opacity').addEventListener('input', (e) => {
        displaySettings.trackOpacity = e.target.value / 100;
        document.getElementById('track-opacity-value').textContent = `${e.target.value}%`;
        renderDiagram();
    });

    document.getElementById('use-line-colors-for-tracks').addEventListener('change', (e) => {
        displaySettings.useLineColorsForTracks = e.target.checked;
        renderDiagram();
    });

    document.getElementById('use-line-colors-for-trains').addEventListener('change', (e) => {
        displaySettings.useLineColorsForTrains = e.target.checked;
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
        // Check if clicking on a waypoint handle
        if (e.target.classList.contains('waypoint-handle')) {
            e.preventDefault();
            const segmentKey = e.target.getAttribute('data-segment-key');
            const waypointIndex = parseInt(e.target.getAttribute('data-waypoint-index'));
            startWaypointDrag(segmentKey, waypointIndex);
            return;
        }

        // Check if clicking on a midpoint handle
        if (e.target.classList.contains('midpoint-handle')) {
            e.preventDefault();
            const segmentKey = e.target.getAttribute('data-segment-key');
            const midX = parseFloat(e.target.getAttribute('cx'));
            const midY = parseFloat(e.target.getAttribute('cy'));
            startMidpointDrag(segmentKey, midX, midY);
            return;
        }

        // Only pan with left mouse button and only if not dragging a waypoint
        if (e.button === 0 && !isDraggingWaypoint) {
            e.preventDefault(); // Prevent text selection during drag
            isPanning = true;
            panStart = { x: e.clientX, y: e.clientY };
            svgElement.style.cursor = 'grabbing';
        }
    });

    svgElement.addEventListener('mousemove', (e) => {
        if (isDraggingWaypoint) {
            handleWaypointDrag(e);
        } else if (isPanning) {
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
            if (isDraggingWaypoint) {
                isDraggingWaypoint = false;
                draggedWaypoint = null;
                renderDiagram();
            }
            isPanning = false;
            svgElement.style.cursor = 'grab';
        }
    });

    svgElement.addEventListener('mouseleave', () => {
        if (isDraggingWaypoint) {
            isDraggingWaypoint = false;
            draggedWaypoint = null;
            renderDiagram();
        }
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
            // Don't call renderDiagram() here - it's called by the caller
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
    let visibleTrains = 0;

    // Step 1: Collect all stations from all lines and group by station name
    const stationsByName = new Map();

    linesToRender.forEach((line, lineIndex) => {
        const stations = line.stations;
        if (!stations || stations.length === 0) return;

        stations.forEach(station => {
            if (!stationsByName.has(station.name)) {
                stationsByName.set(station.name, []);
            }
            stationsByName.get(station.name).push({
                x: station.x,
                y: station.y,
                name: station.name
            });
        });
    });

    // Step 2: Calculate midpoint for each station name
    const stationMidpoints = new Map();

    stationsByName.forEach((positions, stationName) => {
        // Calculate average position (midpoint)
        const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
        const avgY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;

        stationMidpoints.set(stationName, {
            name: stationName,
            x: avgX,
            y: avgY
        });
    });

    // Step 3: Build deduplicated line data using midpoints
    const uniqueSegments = new Map();
    const uniqueStations = new Map();
    const linesData = [];

    // Create a map of line name to group index (for coloring)
    const lineToGroupIndex = new Map();
    const processedGroups = new Set(); // Track which groups we've already processed

    // Build a map of which lines belong to which group
    const lineToGroup = new Map();
    lineGroups.forEach(group => {
        group.lines.forEach(lineName => {
            lineToGroup.set(lineName, group.name);
        });
    });

    // Process groups first: collect all stations from all lines in each group
    lineGroups.forEach((group, groupIndex) => {
        const color = LINE_COLORS[groupIndex % LINE_COLORS.length];
        const groupStationsMap = new Map(); // Map of station name to midpoint
        const groupLinesData = []; // Store line data for trains in this group

        // Collect all stations from all lines in this group
        linesToRender.forEach(line => {
            if (group.lines.has(line.name)) {
                lineToGroupIndex.set(line.name, groupIndex);

                const stations = line.stations;
                if (!stations || stations.length === 0) return;

                // Replace station positions with midpoints and deduplicate
                const processedStations = [];
                const seenNames = new Set();

                stations.forEach(station => {
                    // Skip if we already added this station in this line (circular routes)
                    if (seenNames.has(station.name)) {
                        return;
                    }
                    seenNames.add(station.name);

                    // Get midpoint for this station name
                    const midpoint = stationMidpoints.get(station.name);
                    if (midpoint) {
                        processedStations.push(midpoint);
                        // Add to group stations (will be used to create merged track)
                        if (!groupStationsMap.has(station.name)) {
                            groupStationsMap.set(station.name, midpoint);
                        }
                    }
                });

                // Convert to SVG coordinates for train rendering
                const svgStations = processedStations.map(station => {
                    const pos = gameToSVG(station.x, station.y, bounds);
                    const svgStation = {
                        ...station,
                        svgX: pos.x,
                        svgY: pos.y
                    };

                    // Track unique stations globally (by name)
                    if (!uniqueStations.has(station.name)) {
                        uniqueStations.set(station.name, svgStation);
                    }

                    return svgStation;
                });

                // Store line data for train rendering
                groupLinesData.push({
                    line: line,
                    svgStations: svgStations,
                    color: color
                });
            }
        });

        // Now create merged track segments for this group
        // Find the line with the most stations (typically the local/all-stops service)
        // and use its segments as the base track
        let baseLine = null;
        let maxStations = 0;

        linesToRender.forEach(line => {
            if (group.lines.has(line.name)) {
                const uniqueStationCount = new Set(line.stations.map(s => s.name)).size;
                if (uniqueStationCount > maxStations) {
                    maxStations = uniqueStationCount;
                    baseLine = line;
                }
            }
        });

        // Use the base line's segments for the group track
        if (baseLine && baseLine.stations && baseLine.stations.length > 0) {
            const lineStations = [];
            const seenNames = new Set();

            baseLine.stations.forEach(station => {
                if (seenNames.has(station.name)) return;
                seenNames.add(station.name);

                const midpoint = stationMidpoints.get(station.name);
                if (midpoint) {
                    const pos = gameToSVG(midpoint.x, midpoint.y, bounds);
                    lineStations.push({
                        ...midpoint,
                        svgX: pos.x,
                        svgY: pos.y
                    });
                }
            });

            // Create segments from the base line
            for (let i = 0; i < lineStations.length - 1; i++) {
                const s1 = lineStations[i];
                const s2 = lineStations[i + 1];

                if (s1.name === s2.name) continue;

                const segmentKey = `${group.name}:${i}`;
                uniqueSegments.set(segmentKey, {
                    s1: s1,
                    s2: s2,
                    color: color,
                    group: group.name
                });
            }
        }

        // Add group lines data to main linesData
        linesData.push(...groupLinesData);
        processedGroups.add(group.name);
    });

    // Process ungrouped lines
    linesToRender.forEach((line, lineIndex) => {
        // Skip if this line belongs to a group (already processed)
        if (lineToGroup.has(line.name)) {
            return;
        }

        // Calculate color index for ungrouped lines
        const colorIndex = lineGroups.length + lineIndex;
        const color = LINE_COLORS[colorIndex % LINE_COLORS.length];
        const stations = line.stations;

        if (!stations || stations.length === 0) return;

        // Replace station positions with midpoints and deduplicate
        const processedStations = [];
        const seenNames = new Set();

        stations.forEach(station => {
            if (seenNames.has(station.name)) {
                return;
            }
            seenNames.add(station.name);

            const midpoint = stationMidpoints.get(station.name);
            if (midpoint) {
                processedStations.push(midpoint);
            }
        });

        // Convert to SVG coordinates
        const svgStations = processedStations.map(station => {
            const pos = gameToSVG(station.x, station.y, bounds);
            const svgStation = {
                ...station,
                svgX: pos.x,
                svgY: pos.y
            };

            if (!uniqueStations.has(station.name)) {
                uniqueStations.set(station.name, svgStation);
            }

            return svgStation;
        });

        // Extract track segments from this ungrouped line
        for (let i = 0; i < svgStations.length - 1; i++) {
            const s1 = svgStations[i];
            const s2 = svgStations[i + 1];

            if (s1.name === s2.name) {
                continue;
            }

            const segmentKey = `${line.name}:${i}`;
            uniqueSegments.set(segmentKey, {
                s1: s1,
                s2: s2,
                color: color,
                group: null
            });
        }

        // Store line data for train rendering
        linesData.push({
            line: line,
            svgStations: svgStations,
            color: color
        });
    });

    const totalStations = uniqueStations.size;

    // Draw all unique track segments once (if enabled)
    if (displaySettings.showTracks) {
        uniqueSegments.forEach((segment, segmentKey) => {
            const trackColor = displaySettings.useLineColorsForTracks ? segment.color : displaySettings.trackColor;

            // Get waypoints for this segment (if any)
            const waypoints = segmentWaypoints.get(segmentKey) || [];

            // Build the path through all waypoints
            const points = [
                { x: segment.s1.svgX, y: segment.s1.svgY },
                ...waypoints,
                { x: segment.s2.svgX, y: segment.s2.svgY }
            ];

            // Draw polyline through all points
            if (waypoints.length > 0) {
                const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');
                svgContent += `<polyline points="${pointsStr}" class="rail-line" stroke="${trackColor}" stroke-width="2" stroke-opacity="${displaySettings.trackOpacity}" fill="none" />`;
            } else {
                svgContent += `<line x1="${segment.s1.svgX}" y1="${segment.s1.svgY}" x2="${segment.s2.svgX}" y2="${segment.s2.svgY}" class="rail-line" stroke="${trackColor}" stroke-width="2" stroke-opacity="${displaySettings.trackOpacity}" />`;
            }

            // Draw waypoint handles (if any)
            waypoints.forEach((wp, wpIndex) => {
                svgContent += `<circle cx="${wp.x}" cy="${wp.y}" r="6" class="waypoint-handle" fill="#ff6600" stroke="#fff" stroke-width="2" style="cursor: move;" data-segment-key="${segmentKey}" data-waypoint-index="${wpIndex}" />`;
            });

            // Draw midpoint handle for adding new waypoints
            if (waypoints.length === 0) {
                const midX = (segment.s1.svgX + segment.s2.svgX) / 2;
                const midY = (segment.s1.svgY + segment.s2.svgY) / 2;
                svgContent += `<circle cx="${midX}" cy="${midY}" r="5" class="midpoint-handle" fill="#3b82f6" fill-opacity="0.5" stroke="#fff" stroke-width="2" style="cursor: move;" data-segment-key="${segmentKey}" />`;
            }
        });
    }

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

    // Use line color for train icon, or default colors
    let trainColor;
    if (displaySettings.useLineColorsForTrains) {
        trainColor = color;
    } else {
        trainColor = train.is_loading ? '#fbbf24' : '#ef4444';
    }
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

/**
 * Create a new line group
 */
function createGroup() {
    const input = document.getElementById('group-name-input');
    const groupName = input.value.trim();

    if (!groupName) {
        alert('グループ名を入力してください');
        return;
    }

    // Check if group already exists
    if (lineGroups.some(g => g.name === groupName)) {
        alert('このグループ名は既に存在します');
        return;
    }

    lineGroups.push({
        name: groupName,
        lines: new Set()
    });

    input.value = '';
    updateGroupsList();
    renderDiagram();
}

/**
 * Delete a group
 */
function deleteGroup(groupName) {
    lineGroups = lineGroups.filter(g => g.name !== groupName);
    updateGroupsList();
    renderDiagram();
}

/**
 * Add a line to a group
 */
function addLineToGroup(groupName, lineName) {
    const group = lineGroups.find(g => g.name === groupName);
    if (group) {
        group.lines.add(lineName);
        updateGroupsList();
        renderDiagram();
    }
}

/**
 * Remove a line from a group
 */
function removeLineFromGroup(groupName, lineName) {
    const group = lineGroups.find(g => g.name === groupName);
    if (group) {
        group.lines.delete(lineName);
        updateGroupsList();
        renderDiagram();
    }
}

/**
 * Update groups list display
 */
function updateGroupsList() {
    const container = document.getElementById('groups-list');

    if (lineGroups.length === 0) {
        container.innerHTML = '<p class="loading-text" style="font-size: 0.85rem; color: #9ca3af;">グループはありません</p>';
        return;
    }

    let html = '';

    lineGroups.forEach((group, index) => {
        const color = LINE_COLORS[index % LINE_COLORS.length];

        html += `
            <div style="border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.5rem; margin-bottom: 0.5rem; background: #f9fafb;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <div class="line-color" style="background-color: ${color}; width: 12px; height: 12px; border-radius: 2px;"></div>
                        <strong style="font-size: 0.9rem;">${group.name}</strong>
                    </div>
                    <button onclick="deleteGroup('${group.name.replace(/'/g, "\\'")}')" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; background: #ef4444; color: white; border: none; border-radius: 3px; cursor: pointer;">削除</button>
                </div>
                <div style="margin-top: 0.3rem;">
                    <select onchange="handleAddLineToGroup(this, '${group.name.replace(/'/g, "\\'")}')" style="width: 100%; padding: 0.3rem; font-size: 0.8rem; border: 1px solid #d1d5db; border-radius: 3px;">
                        <option value="">路線を追加...</option>
                        ${getAvailableLinesForGroup(group).map(line =>
                            `<option value="${line}">${line}</option>`
                        ).join('')}
                    </select>
                </div>
                <div style="margin-top: 0.3rem; font-size: 0.8rem;">
                    ${Array.from(group.lines).map(line => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.2rem; background: white; border-radius: 2px; margin-bottom: 0.2rem;">
                            <span>${line}</span>
                            <button onclick="removeLineFromGroup('${group.name.replace(/'/g, "\\'")}', '${line.replace(/'/g, "\\'")}')" style="padding: 0.1rem 0.3rem; font-size: 0.7rem; background: #ef4444; color: white; border: none; border-radius: 2px; cursor: pointer;">×</button>
                        </div>
                    `).join('')}
                    ${group.lines.size === 0 ? '<p style="color: #9ca3af; font-size: 0.75rem; margin: 0;">路線がありません</p>' : ''}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * Get available lines for a group (lines not already in the group)
 */
function getAvailableLinesForGroup(group) {
    if (!stationData || !stationData.lines) return [];

    return stationData.lines
        .map(line => line.name)
        .filter(lineName => !group.lines.has(lineName));
}

/**
 * Handle adding a line to a group from select
 */
function handleAddLineToGroup(select, groupName) {
    const lineName = select.value;
    if (lineName) {
        addLineToGroup(groupName, lineName);
        select.value = '';
    }
}

/**
 * Convert client coordinates to SVG coordinates
 */
function clientToSVG(clientX, clientY) {
    const svgElement = document.getElementById('railroad-diagram');
    const pt = svgElement.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgPt = pt.matrixTransform(svgElement.getScreenCTM().inverse());

    // Account for zoom and pan transform on diagram-content
    const x = (svgPt.x - panOffset.x) / zoomLevel;
    const y = (svgPt.y - panOffset.y) / zoomLevel;

    return { x, y };
}

/**
 * Find nearest station to a given point
 */
function findNearestStation(x, y, stations) {
    let nearest = null;
    let minDist = snapDistance;

    stations.forEach(station => {
        const dist = Math.sqrt(Math.pow(station.svgX - x, 2) + Math.pow(station.svgY - y, 2));
        if (dist < minDist) {
            minDist = dist;
            nearest = station;
        }
    });

    return nearest;
}

/**
 * Handle waypoint drag
 */
function handleWaypointDrag(e) {
    if (!draggedWaypoint) return;

    const svgPos = clientToSVG(e.clientX, e.clientY);

    // Get current segment
    const linesToRender = stationData.lines.filter(line => selectedLines.has(line.name));
    const bounds = calculateBounds(linesToRender);

    // Collect all stations for snapping
    const stationMidpoints = new Map();
    const stationsByName = new Map();

    linesToRender.forEach(line => {
        line.stations.forEach(station => {
            if (!stationsByName.has(station.name)) {
                stationsByName.set(station.name, []);
            }
            stationsByName.get(station.name).push({
                x: station.x,
                y: station.y,
                name: station.name
            });
        });
    });

    stationsByName.forEach((positions, stationName) => {
        const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
        const avgY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
        const pos = gameToSVG(avgX, avgY, bounds);
        stationMidpoints.set(stationName, {
            name: stationName,
            svgX: pos.x,
            svgY: pos.y
        });
    });

    const allStations = Array.from(stationMidpoints.values());

    // Check if near a station
    const nearestStation = findNearestStation(svgPos.x, svgPos.y, allStations);

    let finalPos;
    if (nearestStation) {
        // Snap to station
        finalPos = { x: nearestStation.svgX, y: nearestStation.svgY };
    } else {
        // Use mouse position
        finalPos = svgPos;
    }

    // Update waypoint position
    const waypoints = segmentWaypoints.get(draggedWaypoint.segmentKey) || [];
    if (draggedWaypoint.waypointIndex < waypoints.length) {
        waypoints[draggedWaypoint.waypointIndex] = finalPos;
        segmentWaypoints.set(draggedWaypoint.segmentKey, waypoints);
    }

    // Re-render to show updated position
    renderDiagram();
}

/**
 * Start dragging a waypoint
 */
function startWaypointDrag(segmentKey, waypointIndex) {
    isDraggingWaypoint = true;
    draggedWaypoint = { segmentKey, waypointIndex };
}

/**
 * Start dragging a new waypoint from midpoint
 */
function startMidpointDrag(segmentKey, midX, midY) {
    // Create a new waypoint at the midpoint
    const waypoints = segmentWaypoints.get(segmentKey) || [];
    waypoints.push({ x: midX, y: midY });
    segmentWaypoints.set(segmentKey, waypoints);

    // Start dragging the new waypoint
    isDraggingWaypoint = true;
    draggedWaypoint = { segmentKey, waypointIndex: waypoints.length - 1 };
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
