/**
 * Train Position Tracker - Client-side JavaScript
 * Handles data fetching, filtering, and UI updates
 */

// Global state
let allTrains = [];
let allLines = [];
let selectedLines = new Set();
let updateTimer = null;

// Constants
const API_URL = '/api/trains';
const LINES_URL = '/api/lines';
const UPDATE_INTERVAL = 5000; // 5 seconds

/**
 * Initialize application
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Train Tracker] Initializing...');

    // Load data
    loadLines();
    loadTrainData();

    // Set up auto-update
    startAutoUpdate();

    // Set up event listeners
    document.getElementById('search').addEventListener('input', applyFilters);
    document.getElementById('filter-waytype').addEventListener('change', applyFilters);
    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadTrainData();
        loadLines();
    });

    // Restore selected lines from localStorage
    restoreSelectedLines();
});

/**
 * Load train data from API
 */
async function loadTrainData() {
    try {
        const response = await fetch(API_URL);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            showError('データ取得エラー', data.error);
            return;
        }

        allTrains = data.trains || [];
        updateGameTime(data.game_time);
        updateTimestamp(data.timestamp);
        applyFilters();
        updateStatus('ok');

        hideError();

    } catch (error) {
        console.error('[Train Tracker] Failed to load train data:', error);
        showError('接続エラー', 'サーバーに接続できません: ' + error.message);
        updateStatus('error');
    }
}

/**
 * Load line list from API
 */
async function loadLines() {
    try {
        const response = await fetch(LINES_URL);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        allLines = data.lines || [];
        renderLineCheckboxes();

    } catch (error) {
        console.error('[Train Tracker] Failed to load lines:', error);
    }
}

/**
 * Render line filter checkboxes
 */
function renderLineCheckboxes() {
    const container = document.getElementById('line-filters');

    if (allLines.length === 0) {
        container.innerHTML = '<p style="color: #7f8c8d; font-size: 0.85rem; padding: 0.5rem;">路線データがありません</p>';
        return;
    }

    container.innerHTML = allLines.map(line => `
        <label>
            <input
                type="checkbox"
                value="${escapeHtml(line)}"
                onchange="toggleLine('${escapeHtml(line).replace(/'/g, "\\'")}')"
                ${selectedLines.has(line) || selectedLines.size === 0 ? 'checked' : ''}
            >
            ${escapeHtml(line)}
        </label>
    `).join('');

    // If no lines selected yet, select all
    if (selectedLines.size === 0) {
        selectedLines = new Set(allLines);
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

    applyFilters();
    saveSelectedLines();
}

/**
 * Select all lines
 */
function selectAllLines() {
    selectedLines = new Set(allLines);
    renderLineCheckboxes();
    applyFilters();
    saveSelectedLines();
}

/**
 * Deselect all lines
 */
function deselectAllLines() {
    selectedLines.clear();
    renderLineCheckboxes();
    applyFilters();
    saveSelectedLines();
}

/**
 * Apply all filters and update table
 */
function applyFilters() {
    const searchTerm = document.getElementById('search').value.toLowerCase();
    const waytypeFilter = document.getElementById('filter-waytype').value;

    const filteredTrains = allTrains.filter(train => {
        // Line filter
        if (selectedLines.size > 0 && !selectedLines.has(train.line)) {
            return false;
        }

        // Search filter
        const searchText = [
            train.name,
            train.line,
            train.current_halt || '',
            train.next_halt || ''
        ].join(' ').toLowerCase();

        if (searchTerm && !searchText.includes(searchTerm)) {
            return false;
        }

        // Waytype filter
        if (waytypeFilter && train.waytype !== waytypeFilter) {
            return false;
        }

        return true;
    });

    updateTable(filteredTrains);
    updateStats(filteredTrains.length, allTrains.length);
}

/**
 * Update train table
 */
function updateTable(trains) {
    const tbody = document.getElementById('train-list');
    const noData = document.getElementById('no-data');
    const tableContainer = document.querySelector('.table-container');

    if (trains.length === 0) {
        tbody.innerHTML = '';
        tableContainer.style.display = 'none';
        noData.style.display = 'block';
        return;
    }

    tableContainer.style.display = 'block';
    noData.style.display = 'none';

    tbody.innerHTML = trains.map(train => {
        const statusClass = train.is_loading ? 'loading' : '';
        const statusText = train.is_loading ? '停車中' : '運行中';

        return `
            <tr class="${statusClass}">
                <td>${escapeHtml(train.name)}</td>
                <td>${escapeHtml(train.line)}</td>
                <td>${train.position.x}, ${train.position.y}, ${train.position.z}</td>
                <td>${escapeHtml(train.waytype_ja)}</td>
                <td>${train.speed_kmh}</td>
                <td>${escapeHtml(train.current_halt || '-')}</td>
                <td>${escapeHtml(train.next_halt || '-')}</td>
                <td>${statusText}</td>
            </tr>
        `;
    }).join('');
}

/**
 * Update stats display
 */
function updateStats(visible, total) {
    document.getElementById('visible-count').textContent = visible;
    document.getElementById('total-count').textContent = total;
}

/**
 * Update game time display
 */
function updateGameTime(gameTime) {
    if (!gameTime) return;

    const timeStr = `ゲーム時刻: ${gameTime.year}年 ${gameTime.month + 1}月`;
    document.getElementById('game-time').textContent = timeStr;
}

/**
 * Update timestamp display
 */
function updateTimestamp(timestamp) {
    if (!timestamp) return;

    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    document.getElementById('update-time').textContent = `最終更新: ${timeStr}`;
}

/**
 * Update connection status indicator
 */
function updateStatus(status) {
    const indicator = document.getElementById('connection-status');

    if (status === 'ok') {
        indicator.className = 'status-indicator status-ok';
        indicator.textContent = '● 接続中';
    } else {
        indicator.className = 'status-indicator status-error';
        indicator.textContent = '● 接続エラー';
    }
}

/**
 * Show error message
 */
function showError(title, message) {
    const errorDiv = document.getElementById('error-message');
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-text').textContent = message;
    errorDiv.style.display = 'block';
}

/**
 * Hide error message
 */
function hideError() {
    document.getElementById('error-message').style.display = 'none';
}

/**
 * Start auto-update timer
 */
function startAutoUpdate() {
    if (updateTimer) {
        clearInterval(updateTimer);
    }

    updateTimer = setInterval(() => {
        loadTrainData();
    }, UPDATE_INTERVAL);

    console.log(`[Train Tracker] Auto-update started (${UPDATE_INTERVAL / 1000}s interval)`);
}

/**
 * Save selected lines to localStorage
 */
function saveSelectedLines() {
    try {
        localStorage.setItem('selectedLines', JSON.stringify([...selectedLines]));
    } catch (e) {
        console.warn('[Train Tracker] Failed to save selected lines:', e);
    }
}

/**
 * Restore selected lines from localStorage
 */
function restoreSelectedLines() {
    try {
        const saved = localStorage.getItem('selectedLines');
        if (saved) {
            selectedLines = new Set(JSON.parse(saved));
            console.log('[Train Tracker] Restored selected lines from localStorage');
        }
    } catch (e) {
        console.warn('[Train Tracker] Failed to restore selected lines:', e);
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (text === null || text === undefined) {
        return '';
    }

    const div = document.createElement('div');
    div.textContent = text.toString();
    return div.innerHTML;
}
