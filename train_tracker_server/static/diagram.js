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

    // Load line groups and waypoints from localStorage
    loadLineGroups();
    loadWaypoints();

    // Load profiles list
    updateProfilesList();

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
                saveWaypoints(); // Save waypoints after dragging
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
            saveWaypoints(); // Save waypoints after dragging
            renderDiagram();
        }
        isPanning = false;
        svgElement.style.cursor = 'grab';
    });

    // Right-click to add waypoint on any line
    svgElement.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        handleRightClick(e);
    });

    // Double-click to remove waypoint
    svgElement.addEventListener('dblclick', (e) => {
        if (e.target.classList.contains('waypoint-handle')) {
            e.preventDefault();
            const segmentKey = e.target.getAttribute('data-segment-key');
            const waypointIndex = parseInt(e.target.getAttribute('data-waypoint-index'));
            removeWaypoint(segmentKey, waypointIndex);
        }
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

                // Store line data for train rendering (segments will be added later)
                groupLinesData.push({
                    line: line,
                    svgStations: svgStations,
                    color: color,
                    lineSegments: [] // Will be filled with group segments
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

        // Collect all unique segments from all lines in the group
        const groupSegments = new Map(); // Map of segment key to segment data

        linesToRender.forEach(line => {
            if (group.lines.has(line.name)) {
                const lineStations = [];
                const seenNames = new Set();

                line.stations.forEach(station => {
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

                // Create segments from this line
                for (let i = 0; i < lineStations.length - 1; i++) {
                    const s1 = lineStations[i];
                    const s2 = lineStations[i + 1];

                    if (s1.name === s2.name) continue;

                    // Create a normalized segment key (sort station names to avoid duplicates)
                    // Use only station names for key so all routes sharing this track use the same waypoints
                    const segmentNames = [s1.name, s2.name].sort();
                    const normalizedKey = `${segmentNames[0]}|${segmentNames[1]}`;

                    if (!groupSegments.has(normalizedKey)) {
                        groupSegments.set(normalizedKey, {
                            s1: s1,
                            s2: s2,
                            color: color,
                            group: group.name
                        });
                    }
                }
            }
        });

        // Add all group segments to uniqueSegments
        groupSegments.forEach((segment, key) => {
            uniqueSegments.set(key, segment);
        });

        // Convert groupSegments to array for train snapping (include waypoints directly)
        const groupSegmentsArray = Array.from(groupSegments.entries()).map(([key, seg]) => {
            const relativeWaypoints = segmentWaypoints.get(key) || [];
            const waypoints = relativeWaypoints
                .filter(rel => rel.t !== undefined && rel.offset !== undefined)
                .map(rel => relativeToAbsolute(rel, seg.s1, seg.s2));
            return {
                segmentKey: key,
                s1: seg.s1,
                s2: seg.s2,
                waypoints: waypoints
            };
        });

        // Add segments to each line in the group
        groupLinesData.forEach(ld => {
            ld.lineSegments = groupSegmentsArray;
        });

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
        const lineSegmentsArray = [];
        for (let i = 0; i < svgStations.length - 1; i++) {
            const s1 = svgStations[i];
            const s2 = svgStations[i + 1];

            if (s1.name === s2.name) {
                continue;
            }

            // Use station names in segment key for consistency (sorted for normalization)
            // Use only station names for key so all routes sharing this track use the same waypoints
            const segmentNames = [s1.name, s2.name].sort();
            const segmentKey = `${segmentNames[0]}|${segmentNames[1]}`;
            uniqueSegments.set(segmentKey, {
                s1: s1,
                s2: s2,
                color: color,
                group: null
            });

            // Get waypoints for this segment and convert to absolute coordinates
            const relativeWaypoints = segmentWaypoints.get(segmentKey) || [];
            const waypoints = relativeWaypoints
                .filter(rel => rel.t !== undefined && rel.offset !== undefined)
                .map(rel => relativeToAbsolute(rel, s1, s2));

            lineSegmentsArray.push({
                segmentKey: segmentKey,
                s1: s1,
                s2: s2,
                waypoints: waypoints
            });
        }

        // Store line data for train rendering
        linesData.push({
            line: line,
            svgStations: svgStations,
            color: color,
            lineSegments: lineSegmentsArray
        });
    });

    const totalStations = uniqueStations.size;

    // Draw all unique track segments once (if enabled)
    if (displaySettings.showTracks) {
        uniqueSegments.forEach((segment, segmentKey) => {
            const trackColor = displaySettings.useLineColorsForTracks ? segment.color : displaySettings.trackColor;

            // Get waypoints for this segment (if any) and convert from relative to absolute coordinates
            const relativeWaypoints = segmentWaypoints.get(segmentKey) || [];
            const waypoints = relativeWaypoints
                .filter(rel => rel.t !== undefined && rel.offset !== undefined) // Only use relative format
                .map(rel => relativeToAbsolute(rel, segment.s1, segment.s2));

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
                // Draw a larger invisible circle for better hit detection
                svgContent += `<circle cx="${wp.x}" cy="${wp.y}" r="15" class="waypoint-handle" fill="transparent" stroke="none" style="cursor: move;" data-segment-key="${segmentKey}" data-waypoint-index="${wpIndex}" />`;
                // Draw the visible handle
                svgContent += `<circle cx="${wp.x}" cy="${wp.y}" r="6" fill="#ff6600" stroke="#fff" stroke-width="2" style="pointer-events: none;" />`;
            });

            // Draw midpoint handle for adding new waypoints
            if (waypoints.length === 0) {
                const midX = (segment.s1.svgX + segment.s2.svgX) / 2;
                const midY = (segment.s1.svgY + segment.s2.svgY) / 2;
                // Draw a larger invisible circle for better hit detection
                svgContent += `<circle cx="${midX}" cy="${midY}" r="15" class="midpoint-handle" fill="transparent" stroke="none" style="cursor: move;" data-segment-key="${segmentKey}" />`;
                // Draw the visible handle
                svgContent += `<circle cx="${midX}" cy="${midY}" r="5" fill="#3b82f6" fill-opacity="0.5" stroke="#fff" stroke-width="2" style="pointer-events: none;" />`;
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
                    const trainSvg = renderTrain(train, bounds, lineData.color, lineData.svgStations, lineData.lineSegments);
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
 * Convert absolute waypoint coordinates to relative coordinates (t, offset)
 * t: position along the segment (0=s1, 1=s2)
 * offset: perpendicular distance from the segment
 */
function absoluteToRelative(wp, s1, s2) {
    const dx = s2.svgX - s1.svgX;
    const dy = s2.svgY - s1.svgY;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        return { t: 0, offset: 0 };
    }

    const length = Math.sqrt(lengthSquared);

    // Vector from s1 to wp
    const wx = wp.x - s1.svgX;
    const wy = wp.y - s1.svgY;

    // t = projection of wp onto segment line
    const t = (wx * dx + wy * dy) / lengthSquared;

    // offset = perpendicular distance (positive = left side when going s1->s2)
    const offset = (wx * (-dy) + wy * dx) / length;

    return { t, offset };
}

/**
 * Convert relative waypoint coordinates back to absolute coordinates
 */
function relativeToAbsolute(rel, s1, s2) {
    const dx = s2.svgX - s1.svgX;
    const dy = s2.svgY - s1.svgY;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) {
        return { x: s1.svgX, y: s1.svgY };
    }

    // Unit vectors
    const ux = dx / length;
    const uy = dy / length;

    // Perpendicular unit vector (90 degrees counterclockwise)
    const px = -uy;
    const py = ux;

    // Calculate absolute position
    const x = s1.svgX + rel.t * dx + rel.offset * px;
    const y = s1.svgY + rel.t * dy + rel.offset * py;

    return { x, y };
}

/**
 * Find nearest point on track (any segment of the line, including waypoints)
 * Returns both the point and the segment direction
 */
function snapToTrack(trainPos, svgStations, lineSegments) {
    if (!svgStations || svgStations.length < 2) {
        return { point: trainPos, angle: 0 };
    }

    let minDist = Infinity;
    let nearest = trainPos;
    let segmentAngle = 0;

    // If lineSegments with waypoints are provided, use them
    if (lineSegments && lineSegments.length > 0) {
        lineSegments.forEach(seg => {
            // Use waypoints directly from lineSegments (already converted to absolute coordinates)
            const waypoints = seg.waypoints || [];
            const points = [
                { x: seg.s1.svgX, y: seg.s1.svgY },
                ...waypoints,
                { x: seg.s2.svgX, y: seg.s2.svgY }
            ];

            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i + 1];

                const point = nearestPointOnSegment(trainPos.x, trainPos.y, p1.x, p1.y, p2.x, p2.y);
                const dist = Math.sqrt(Math.pow(point.x - trainPos.x, 2) + Math.pow(point.y - trainPos.y, 2));

                if (dist < minDist) {
                    minDist = dist;
                    nearest = point;
                    segmentAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
                }
            }
        });
    } else {
        // Fallback: use direct station-to-station segments
        for (let i = 0; i < svgStations.length - 1; i++) {
            const s1 = svgStations[i];
            const s2 = svgStations[i + 1];

            const point = nearestPointOnSegment(trainPos.x, trainPos.y, s1.svgX, s1.svgY, s2.svgX, s2.svgY);
            const dist = Math.sqrt(Math.pow(point.x - trainPos.x, 2) + Math.pow(point.y - trainPos.y, 2));

            if (dist < minDist) {
                minDist = dist;
                nearest = point;
                segmentAngle = Math.atan2(s2.svgY - s1.svgY, s2.svgX - s1.svgX) * 180 / Math.PI;
            }
        }
    }

    return { point: nearest, angle: segmentAngle };
}

/**
 * Render train at actual game position, snapped to track
 * Trains are rendered as directional triangles
 */
function renderTrain(train, bounds, color, svgStations, lineSegments) {
    if (!train.position) return '';

    // Convert train position to SVG coordinates
    let trainSvgPos = gameToSVG(train.position.x, train.position.y, bounds);

    // Snap to nearest point on track and get direction (including waypoints)
    const snapResult = snapToTrack(trainSvgPos, svgStations, lineSegments);
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
 * Save line groups to localStorage
 */
function saveLineGroups() {
    try {
        const serialized = lineGroups.map(group => ({
            name: group.name,
            lines: Array.from(group.lines)
        }));
        localStorage.setItem('lineGroups', JSON.stringify(serialized));
        console.log('[Diagram] Line groups saved to localStorage');
    } catch (e) {
        console.warn('[Diagram] Failed to save line groups:', e);
    }
}

/**
 * Load line groups from localStorage
 */
function loadLineGroups() {
    try {
        const saved = localStorage.getItem('lineGroups');
        if (saved) {
            const parsed = JSON.parse(saved);
            lineGroups = parsed.map(group => ({
                name: group.name,
                lines: new Set(group.lines)
            }));
            console.log('[Diagram] Line groups loaded from localStorage:', lineGroups.length);
        } else {
            lineGroups = [];
        }
        updateGroupsList();
    } catch (e) {
        console.warn('[Diagram] Failed to load line groups:', e);
        lineGroups = [];
        updateGroupsList();
    }
}

/**
 * Save waypoints to localStorage
 */
function saveWaypoints() {
    try {
        const serialized = Array.from(segmentWaypoints.entries()).map(([key, waypoints]) => ({
            key: key,
            waypoints: waypoints
        }));
        localStorage.setItem('segmentWaypoints', JSON.stringify(serialized));
        console.log('[Diagram] Waypoints saved to localStorage');
    } catch (e) {
        console.warn('[Diagram] Failed to save waypoints:', e);
    }
}

/**
 * Load waypoints from localStorage
 */
function loadWaypoints() {
    try {
        const saved = localStorage.getItem('segmentWaypoints');
        if (saved) {
            const parsed = JSON.parse(saved);
            segmentWaypoints = new Map();

            // Migrate old format keys to new format
            parsed.forEach(item => {
                let key = item.key;

                // Check if it's old format with prefix (prefix:stationA|stationB)
                const colonIndex = key.indexOf(':');
                if (colonIndex !== -1) {
                    // Extract just the station part
                    key = key.substring(colonIndex + 1);
                    console.log('[Diagram] Migrated old key format to:', key);
                }

                // Merge waypoints if key already exists
                if (segmentWaypoints.has(key)) {
                    const existing = segmentWaypoints.get(key);
                    // Append non-duplicate waypoints
                    item.waypoints.forEach(wp => {
                        if (!existing.some(e => e.t === wp.t && e.offset === wp.offset)) {
                            existing.push(wp);
                        }
                    });
                } else {
                    segmentWaypoints.set(key, item.waypoints);
                }
            });

            console.log('[Diagram] Waypoints loaded from localStorage:', segmentWaypoints.size);

            // Save with new format
            saveWaypoints();
        } else {
            segmentWaypoints = new Map();
        }
    } catch (e) {
        console.warn('[Diagram] Failed to load waypoints:', e);
        segmentWaypoints = new Map();
    }
}

/**
 * Save current state as a profile
 */
function saveProfile() {
    const input = document.getElementById('profile-name-input');
    const profileName = input.value.trim();

    if (!profileName) {
        alert('プロファイル名を入力してください');
        return;
    }

    // Collect current state
    const profile = {
        name: profileName,
        timestamp: new Date().toISOString(),
        selectedLines: Array.from(selectedLines),
        displaySettings: {
            showTracks: displaySettings.showTracks,
            showStationNames: displaySettings.showStationNames,
            showTrainNames: displaySettings.showTrainNames,
            showSpeeds: displaySettings.showSpeeds,
            trackColor: displaySettings.trackColor,
            trackOpacity: displaySettings.trackOpacity,
            useLineColorsForTracks: displaySettings.useLineColorsForTracks,
            useLineColorsForTrains: displaySettings.useLineColorsForTrains
        },
        lineGroups: lineGroups.map(group => ({
            name: group.name,
            lines: Array.from(group.lines)
        })),
        segmentWaypoints: Array.from(segmentWaypoints.entries()).map(([key, waypoints]) => ({
            key: key,
            waypoints: waypoints
        }))
    };

    // Get existing profiles
    let profiles = [];
    try {
        const saved = localStorage.getItem('diagramProfiles');
        if (saved) {
            profiles = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('[Diagram] Failed to load existing profiles:', e);
    }

    // Check if profile with same name exists
    const existingIndex = profiles.findIndex(p => p.name === profileName);
    if (existingIndex >= 0) {
        if (!confirm(`プロファイル「${profileName}」は既に存在します。上書きしますか?`)) {
            return;
        }
        profiles[existingIndex] = profile;
    } else {
        profiles.push(profile);
    }

    // Save to localStorage
    try {
        localStorage.setItem('diagramProfiles', JSON.stringify(profiles));
        console.log('[Diagram] Profile saved:', profileName);
        input.value = '';
        updateProfilesList();
        alert(`プロファイル「${profileName}」を保存しました`);
    } catch (e) {
        console.error('[Diagram] Failed to save profile:', e);
        alert('プロファイルの保存に失敗しました');
    }
}

/**
 * Load a profile
 */
function loadProfile(profileName) {
    try {
        const saved = localStorage.getItem('diagramProfiles');
        if (!saved) {
            alert('プロファイルが見つかりません');
            return;
        }

        const profiles = JSON.parse(saved);
        const profile = profiles.find(p => p.name === profileName);

        if (!profile) {
            alert('プロファイルが見つかりません');
            return;
        }

        // Restore state
        selectedLines = new Set(profile.selectedLines || []);

        displaySettings = {
            showTracks: profile.displaySettings.showTracks,
            showStationNames: profile.displaySettings.showStationNames,
            showTrainNames: profile.displaySettings.showTrainNames,
            showSpeeds: profile.displaySettings.showSpeeds,
            trackColor: profile.displaySettings.trackColor,
            trackOpacity: profile.displaySettings.trackOpacity,
            useLineColorsForTracks: profile.displaySettings.useLineColorsForTracks,
            useLineColorsForTrains: profile.displaySettings.useLineColorsForTrains
        };

        lineGroups = (profile.lineGroups || []).map(group => ({
            name: group.name,
            lines: new Set(group.lines)
        }));

        // Load waypoints and migrate old format keys
        segmentWaypoints = new Map();
        (profile.segmentWaypoints || []).forEach(item => {
            let key = item.key;
            // Convert old format key if needed
            const colonIndex = key.indexOf(':');
            if (colonIndex !== -1) {
                key = key.substring(colonIndex + 1);
            }
            // Merge waypoints if key already exists
            if (segmentWaypoints.has(key)) {
                const existing = segmentWaypoints.get(key);
                item.waypoints.forEach(wp => {
                    if (!existing.some(e => e.t === wp.t && e.offset === wp.offset)) {
                        existing.push(wp);
                    }
                });
            } else {
                segmentWaypoints.set(key, item.waypoints);
            }
        });

        // Update UI
        document.getElementById('show-tracks').checked = displaySettings.showTracks;
        document.getElementById('show-station-names').checked = displaySettings.showStationNames;
        document.getElementById('show-train-names').checked = displaySettings.showTrainNames;
        document.getElementById('show-speeds').checked = displaySettings.showSpeeds;
        document.getElementById('track-color').value = displaySettings.trackColor;
        document.getElementById('track-opacity').value = displaySettings.trackOpacity * 100;
        document.getElementById('track-opacity-value').textContent = `${Math.round(displaySettings.trackOpacity * 100)}%`;
        document.getElementById('use-line-colors-for-tracks').checked = displaySettings.useLineColorsForTracks;
        document.getElementById('use-line-colors-for-trains').checked = displaySettings.useLineColorsForTrains;

        // Save to localStorage
        saveLineGroups();
        saveWaypoints();

        // Update display
        updateLineSelector();
        updateGroupsList();
        renderDiagram();

        console.log('[Diagram] Profile loaded:', profileName);
        alert(`プロファイル「${profileName}」を読み込みました`);
    } catch (e) {
        console.error('[Diagram] Failed to load profile:', e);
        alert('プロファイルの読み込みに失敗しました');
    }
}

/**
 * Delete a profile
 */
function deleteProfile(profileName) {
    if (!confirm(`プロファイル「${profileName}」を削除しますか?`)) {
        return;
    }

    try {
        const saved = localStorage.getItem('diagramProfiles');
        if (!saved) return;

        let profiles = JSON.parse(saved);
        profiles = profiles.filter(p => p.name !== profileName);

        localStorage.setItem('diagramProfiles', JSON.stringify(profiles));
        updateProfilesList();
        console.log('[Diagram] Profile deleted:', profileName);
        alert(`プロファイル「${profileName}」を削除しました`);
    } catch (e) {
        console.error('[Diagram] Failed to delete profile:', e);
        alert('プロファイルの削除に失敗しました');
    }
}

/**
 * Update profiles list display
 */
function updateProfilesList() {
    const container = document.getElementById('profiles-list');

    try {
        const saved = localStorage.getItem('diagramProfiles');
        if (!saved) {
            container.innerHTML = '<p class="loading-text" style="font-size: 0.85rem; color: #9ca3af;">保存されたプロファイルはありません</p>';
            return;
        }

        const profiles = JSON.parse(saved);
        if (profiles.length === 0) {
            container.innerHTML = '<p class="loading-text" style="font-size: 0.85rem; color: #9ca3af;">保存されたプロファイルはありません</p>';
            return;
        }

        let html = '';
        profiles.forEach(profile => {
            const date = new Date(profile.timestamp);
            const dateStr = date.toLocaleString('ja-JP');

            html += `
                <div style="border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.4rem; margin-bottom: 0.4rem; background: #f9fafb;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.2rem;">
                        <strong style="font-size: 0.85rem;">${profile.name}</strong>
                        <div style="display: flex; gap: 0.3rem;">
                            <button onclick="loadProfile('${profile.name.replace(/'/g, "\\'")}')" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; background: #3b82f6; color: white; border: none; border-radius: 3px; cursor: pointer;">読込</button>
                            <button onclick="deleteProfile('${profile.name.replace(/'/g, "\\'")}')" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; background: #ef4444; color: white; border: none; border-radius: 3px; cursor: pointer;">削除</button>
                        </div>
                    </div>
                    <div style="font-size: 0.7rem; color: #6b7280;">${dateStr}</div>
                </div>
            `;
        });

        container.innerHTML = html;
    } catch (e) {
        console.error('[Diagram] Failed to update profiles list:', e);
        container.innerHTML = '<p class="loading-text" style="font-size: 0.85rem; color: #9ca3af;">エラーが発生しました</p>';
    }
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
    saveLineGroups();
    updateGroupsList();
    renderDiagram();
}

/**
 * Delete a group
 */
function deleteGroup(groupName) {
    lineGroups = lineGroups.filter(g => g.name !== groupName);
    saveLineGroups();
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
        saveLineGroups();
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
        saveLineGroups();
        updateGroupsList();
        renderDiagram();
    }
}

/**
 * Toggle visibility of all lines in a group
 */
function toggleGroupVisibility(groupName) {
    const group = lineGroups.find(g => g.name === groupName);
    if (!group || group.lines.size === 0) return;

    // Check if all lines in the group are currently visible
    const allVisible = Array.from(group.lines).every(line => selectedLines.has(line));

    if (allVisible) {
        // Hide all lines in the group
        group.lines.forEach(line => selectedLines.delete(line));
    } else {
        // Show all lines in the group
        group.lines.forEach(line => selectedLines.add(line));
    }

    updateLineSelector();
    renderDiagram();
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

        // Check if all lines in the group are visible
        const allVisible = Array.from(group.lines).every(line => selectedLines.has(line));
        const visibilityButtonText = allVisible ? '非表示' : '表示';
        const visibilityButtonColor = allVisible ? '#ef4444' : '#10b981';

        html += `
            <div style="border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.5rem; margin-bottom: 0.5rem; background: #f9fafb;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <div class="line-color" style="background-color: ${color}; width: 12px; height: 12px; border-radius: 2px;"></div>
                        <strong style="font-size: 0.9rem;">${group.name}</strong>
                    </div>
                    <div style="display: flex; gap: 0.3rem;">
                        <button onclick="toggleGroupVisibility('${group.name.replace(/'/g, "\\'")}')" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; background: ${visibilityButtonColor}; color: white; border: none; border-radius: 3px; cursor: pointer;">${visibilityButtonText}</button>
                        <button onclick="deleteGroup('${group.name.replace(/'/g, "\\'")}')" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; background: #ef4444; color: white; border: none; border-radius: 3px; cursor: pointer;">削除</button>
                    </div>
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

    // Find the segment data to convert to relative coordinates
    const segmentData = getSegmentData(draggedWaypoint.segmentKey, linesToRender, stationMidpoints, bounds);

    // Update waypoint position (convert to relative coordinates)
    const waypoints = segmentWaypoints.get(draggedWaypoint.segmentKey) || [];
    if (draggedWaypoint.waypointIndex < waypoints.length) {
        if (segmentData) {
            // Save as relative coordinates
            const relativePos = absoluteToRelative(finalPos, segmentData.s1, segmentData.s2);
            waypoints[draggedWaypoint.waypointIndex] = relativePos;
        } else {
            // Fallback to absolute coordinates if segment not found
            waypoints[draggedWaypoint.waypointIndex] = finalPos;
        }
        segmentWaypoints.set(draggedWaypoint.segmentKey, waypoints);
    }

    // Re-render to show updated position
    renderDiagram();
}

/**
 * Get segment data by segment key
 */
function getSegmentData(segmentKey, linesToRender, stationMidpoints, bounds) {
    // Parse segment key to find the segment
    // New format: "stationA|stationB" (just station names, no prefix)
    // Old format (for backward compatibility): "prefix:stationA|stationB"

    let stationPart = segmentKey;

    // Check if it's old format with prefix
    const colonIndex = segmentKey.indexOf(':');
    if (colonIndex !== -1) {
        stationPart = segmentKey.substring(colonIndex + 1);
    }

    // Parse station names (format: "stationA|stationB")
    const pipeIndex = stationPart.indexOf('|');
    if (pipeIndex === -1) return null;

    const stationA = stationPart.substring(0, pipeIndex);
    const stationB = stationPart.substring(pipeIndex + 1);

    const s1Data = stationMidpoints.get(stationA);
    const s2Data = stationMidpoints.get(stationB);

    if (s1Data && s2Data) {
        return { s1: s1Data, s2: s2Data };
    }

    return null;
}

/**
 * Start dragging a waypoint
 */
function startWaypointDrag(segmentKey, waypointIndex) {
    isDraggingWaypoint = true;
    draggedWaypoint = { segmentKey, waypointIndex };
}

/**
 * Remove a waypoint from a segment
 */
function removeWaypoint(segmentKey, waypointIndex) {
    const waypoints = segmentWaypoints.get(segmentKey);
    if (waypoints && waypointIndex >= 0 && waypointIndex < waypoints.length) {
        waypoints.splice(waypointIndex, 1);
        if (waypoints.length === 0) {
            segmentWaypoints.delete(segmentKey);
        } else {
            segmentWaypoints.set(segmentKey, waypoints);
        }
        saveWaypoints();
        renderDiagram();
    }
}

/**
 * Reset all waypoints to initial state (clear all waypoints to show midpoint handles)
 */
function resetAllWaypoints() {
    if (!confirm('すべてのドラッグポイントをクリアしますか?')) {
        return;
    }

    // Clear all existing waypoints
    segmentWaypoints.clear();

    saveWaypoints();
    renderDiagram();
    alert('ドラッグポイントをクリアしました');
}

/**
 * Recalculate waypoints for current segment positions
 * This converts old absolute format to new relative format and removes orphaned waypoints
 */
function recalculateWaypoints() {
    if (!stationData || selectedLines.size === 0) {
        alert('路線を選択してください');
        return;
    }

    const linesToRender = stationData.lines.filter(line => selectedLines.has(line.name));
    if (linesToRender.length === 0) {
        alert('路線を選択してください');
        return;
    }

    const bounds = calculateBounds(linesToRender);

    // Build station midpoints
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

    const stationMidpoints = new Map();
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

    // Build current segments
    const currentSegments = new Map();

    // Build line to group map
    const lineToGroup = new Map();
    lineGroups.forEach(group => {
        group.lines.forEach(lineName => {
            lineToGroup.set(lineName, group.name);
        });
    });

    // Process groups
    lineGroups.forEach((group) => {
        linesToRender.forEach(line => {
            if (group.lines.has(line.name)) {
                const lineStations = [];
                const seenNames = new Set();

                line.stations.forEach(station => {
                    if (seenNames.has(station.name)) return;
                    seenNames.add(station.name);

                    const midpoint = stationMidpoints.get(station.name);
                    if (midpoint) {
                        lineStations.push(midpoint);
                    }
                });

                for (let i = 0; i < lineStations.length - 1; i++) {
                    const s1 = lineStations[i];
                    const s2 = lineStations[i + 1];

                    if (s1.name === s2.name) continue;

                    const segmentNames = [s1.name, s2.name].sort();
                    const normalizedKey = `${segmentNames[0]}|${segmentNames[1]}`;

                    if (!currentSegments.has(normalizedKey)) {
                        currentSegments.set(normalizedKey, { s1: s1, s2: s2 });
                    }
                }
            }
        });
    });

    // Process ungrouped lines
    linesToRender.forEach((line) => {
        if (lineToGroup.has(line.name)) return;

        const stations = line.stations;
        if (!stations || stations.length === 0) return;

        const processedStations = [];
        const seenNames = new Set();

        stations.forEach(station => {
            if (seenNames.has(station.name)) return;
            seenNames.add(station.name);

            const midpoint = stationMidpoints.get(station.name);
            if (midpoint) {
                processedStations.push(midpoint);
            }
        });

        for (let i = 0; i < processedStations.length - 1; i++) {
            const s1 = processedStations[i];
            const s2 = processedStations[i + 1];

            if (s1.name === s2.name) continue;

            const segmentNames = [s1.name, s2.name].sort();
            const segmentKey = `${segmentNames[0]}|${segmentNames[1]}`;
            currentSegments.set(segmentKey, { s1: s1, s2: s2 });
        }
    });

    // Recalculate waypoints
    const newWaypoints = new Map();
    let convertedCount = 0;
    let removedCount = 0;

    segmentWaypoints.forEach((waypoints, segmentKey) => {
        // Convert old format key if needed
        let normalizedKey = segmentKey;
        const colonIndex = segmentKey.indexOf(':');
        if (colonIndex !== -1) {
            normalizedKey = segmentKey.substring(colonIndex + 1);
        }

        const segment = currentSegments.get(normalizedKey);

        if (!segment) {
            // Segment doesn't exist in current selection - remove
            removedCount += waypoints.length;
            return;
        }

        const newWaypointList = [];
        waypoints.forEach(wp => {
            if (wp.t !== undefined && wp.offset !== undefined) {
                // Already in relative format - keep as is
                newWaypointList.push(wp);
            } else if (wp.x !== undefined && wp.y !== undefined) {
                // Old absolute format - convert to relative
                const relativePos = absoluteToRelative(wp, segment.s1, segment.s2);
                newWaypointList.push(relativePos);
                convertedCount++;
            }
        });

        if (newWaypointList.length > 0) {
            newWaypoints.set(normalizedKey, newWaypointList);
        }
    });

    // Update waypoints
    segmentWaypoints.clear();
    newWaypoints.forEach((waypoints, key) => {
        segmentWaypoints.set(key, waypoints);
    });

    saveWaypoints();
    renderDiagram();

    let message = 'ドラッグポイントを再配置しました';
    if (convertedCount > 0) {
        message += `\n${convertedCount}個の古い形式を変換しました`;
    }
    if (removedCount > 0) {
        message += `\n${removedCount}個の不要なポイントを削除しました`;
    }
    alert(message);
}

/**
 * Start dragging a new waypoint from midpoint
 */
function startMidpointDrag(segmentKey, midX, midY) {
    // Create a new waypoint at the midpoint (t=0.5, offset=0 in relative coordinates)
    const waypoints = segmentWaypoints.get(segmentKey) || [];
    waypoints.push({ t: 0.5, offset: 0 });
    segmentWaypoints.set(segmentKey, waypoints);

    // Start dragging the new waypoint
    isDraggingWaypoint = true;
    draggedWaypoint = { segmentKey, waypointIndex: waypoints.length - 1 };
}

/**
 * Handle right-click to add waypoint on track
 */
function handleRightClick(e) {
    const svgPos = clientToSVG(e.clientX, e.clientY);

    // Build current segments map
    if (!stationData || selectedLines.size === 0) return;

    // Only allow adding waypoints to visible (selected) lines
    const linesToRender = stationData.lines.filter(line => selectedLines.has(line.name));
    if (linesToRender.length === 0) return;

    const bounds = calculateBounds(linesToRender);

    // Rebuild segment data (same logic as renderDiagram)
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

    const stationMidpoints = new Map();
    stationsByName.forEach((positions, stationName) => {
        const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
        const avgY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
        stationMidpoints.set(stationName, { name: stationName, x: avgX, y: avgY });
    });

    const allSegments = new Map();

    // Build line to group map
    const lineToGroup = new Map();
    lineGroups.forEach(group => {
        group.lines.forEach(lineName => {
            lineToGroup.set(lineName, group.name);
        });
    });

    // Process groups
    lineGroups.forEach((group, groupIndex) => {
        const color = LINE_COLORS[groupIndex % LINE_COLORS.length];
        const groupSegments = new Map();

        linesToRender.forEach(line => {
            if (group.lines.has(line.name)) {
                const lineStations = [];
                const seenNames = new Set();

                line.stations.forEach(station => {
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

                for (let i = 0; i < lineStations.length - 1; i++) {
                    const s1 = lineStations[i];
                    const s2 = lineStations[i + 1];

                    if (s1.name === s2.name) continue;

                    const segmentNames = [s1.name, s2.name].sort();
                    const normalizedKey = `${segmentNames[0]}|${segmentNames[1]}`;

                    if (!groupSegments.has(normalizedKey)) {
                        groupSegments.set(normalizedKey, { s1: s1, s2: s2, color: color, group: group.name });
                    }
                }
            }
        });

        groupSegments.forEach((segment, key) => {
            allSegments.set(key, segment);
        });
    });

    // Process ungrouped lines
    linesToRender.forEach((line, lineIndex) => {
        if (lineToGroup.has(line.name)) return;

        const colorIndex = lineGroups.length + lineIndex;
        const color = LINE_COLORS[colorIndex % LINE_COLORS.length];
        const stations = line.stations;

        if (!stations || stations.length === 0) return;

        const processedStations = [];
        const seenNames = new Set();

        stations.forEach(station => {
            if (seenNames.has(station.name)) return;
            seenNames.add(station.name);

            const midpoint = stationMidpoints.get(station.name);
            if (midpoint) {
                processedStations.push(midpoint);
            }
        });

        const svgStations = processedStations.map(station => {
            const pos = gameToSVG(station.x, station.y, bounds);
            return {
                ...station,
                svgX: pos.x,
                svgY: pos.y
            };
        });

        for (let i = 0; i < svgStations.length - 1; i++) {
            const s1 = svgStations[i];
            const s2 = svgStations[i + 1];

            if (s1.name === s2.name) continue;

            // Use station names in segment key for consistency (sorted for normalization)
            const segmentNames = [s1.name, s2.name].sort();
            const segmentKey = `${segmentNames[0]}|${segmentNames[1]}`;
            allSegments.set(segmentKey, { s1: s1, s2: s2, color: color, group: null });
        }
    });

    // Find nearest segment
    const result = findNearestSegment(svgPos.x, svgPos.y, allSegments);

    if (result && result.distance < 30) { // Within 30 pixels
        const { segmentKey, nearestPoint } = result;

        // Get segment data for conversion to relative coordinates
        const segment = allSegments.get(segmentKey);

        // Add waypoint at the nearest point (convert to relative coordinates)
        const waypoints = segmentWaypoints.get(segmentKey) || [];
        if (segment) {
            const relativePos = absoluteToRelative(nearestPoint, segment.s1, segment.s2);
            waypoints.push(relativePos);
        } else {
            waypoints.push(nearestPoint); // Fallback
        }
        segmentWaypoints.set(segmentKey, waypoints);

        // Start dragging the new waypoint
        isDraggingWaypoint = true;
        draggedWaypoint = { segmentKey, waypointIndex: waypoints.length - 1 };

        saveWaypoints(); // Save waypoints after adding
        renderDiagram();
    }
}

/**
 * Find nearest segment to a given point
 */
function findNearestSegment(x, y, segments) {
    let minDist = Infinity;
    let result = null;

    segments.forEach((segment, segmentKey) => {
        const relativeWaypoints = segmentWaypoints.get(segmentKey) || [];

        // Convert waypoints from relative to absolute coordinates (only use relative format)
        const waypoints = relativeWaypoints
            .filter(rel => rel.t !== undefined && rel.offset !== undefined)
            .map(rel => relativeToAbsolute(rel, segment.s1, segment.s2));

        // Build the path through all waypoints
        const points = [
            { x: segment.s1.svgX, y: segment.s1.svgY },
            ...waypoints,
            { x: segment.s2.svgX, y: segment.s2.svgY }
        ];

        // Check distance to each segment of the path
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            const nearest = nearestPointOnSegment(x, y, p1.x, p1.y, p2.x, p2.y);
            const dist = Math.sqrt(Math.pow(nearest.x - x, 2) + Math.pow(nearest.y - y, 2));

            if (dist < minDist) {
                minDist = dist;
                result = {
                    segmentKey: segmentKey,
                    nearestPoint: nearest,
                    distance: dist
                };
            }
        }
    });

    return result;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
