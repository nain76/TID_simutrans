/**
 * Simutrans TiD Web UI
 * Train Information Display - JavaScript
 */

class TiDDisplay {
    constructor() {
        this.canvas = document.getElementById('tid-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.trains = [];
        this.config = null;
        this.updateInterval = 4000; // 4 seconds
        this.connected = false;
        this.loadingOverlay = document.getElementById('loading-overlay');
    }

    async init() {
        console.log('TiD Display initializing...');

        try {
            // Fetch initial configuration
            this.config = await this.fetchConfig();
            console.log('Configuration loaded:', this.config);

            // Setup canvas
            this.setupCanvas();

            // Hide loading overlay
            this.loadingOverlay.classList.add('hidden');

            // Start polling for data
            this.startPolling();

            // Start clock
            this.startClock();

            // Initial status update
            this.updateConnectionStatus(true);

        } catch (e) {
            console.error('Failed to initialize:', e);
            this.showError('サーバーに接続できません',
                'TiDサーバーが起動しているか確認してください');
            this.updateConnectionStatus(false);
        }
    }

    setupCanvas() {
        const stations = this.config.sections[0]?.stations || [];
        const numStations = Math.max(stations.length, 5); // 最小5駅分
        const stationSpacing = 150;
        const margin = 200;

        // 横長のキャンバス
        this.canvas.width = Math.max(numStations * stationSpacing + margin, window.innerWidth);
        this.canvas.height = 600;

        console.log(`Canvas size: ${this.canvas.width}x${this.canvas.height}`);
    }

    async fetchConfig() {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('Failed to fetch config');
        return await response.json();
    }

    async fetchTrains() {
        const response = await fetch('/api/trains');
        if (!response.ok) throw new Error('Failed to fetch trains');
        return await response.json();
    }

    startPolling() {
        // Poll immediately
        this.poll();

        // Then poll at intervals
        setInterval(() => this.poll(), this.updateInterval);
    }

    async poll() {
        try {
            const data = await this.fetchTrains();
            this.trains = data.trains || [];
            this.render();
            this.updateConnectionStatus(true);

            // Update train count
            document.getElementById('train-count').textContent = `列車数: ${this.trains.length}`;

        } catch (e) {
            console.error('Polling error:', e);
            this.updateConnectionStatus(false);
        }
    }

    startClock() {
        const updateClock = () => {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('ja-JP', { hour12: false });
            document.getElementById('clock').textContent = timeStr;
        };

        updateClock();
        setInterval(updateClock, 1000);
    }

    updateConnectionStatus(connected) {
        const status = document.getElementById('update-status');
        if (connected) {
            status.textContent = '⚫ 接続中';
            status.className = 'connected';
            this.connected = true;
        } else {
            status.textContent = '⚫ 切断';
            status.className = 'disconnected';
            this.connected = false;
        }
    }

    render() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw grid background
        this.drawGrid();

        // Draw tracks
        this.drawTracks();

        // Draw stations
        this.drawStations();

        // Draw trains
        this.drawTrains();
    }

    drawGrid() {
        this.ctx.strokeStyle = 'rgba(74, 144, 226, 0.1)';
        this.ctx.lineWidth = 1;

        // Vertical lines
        for (let x = 0; x < this.canvas.width; x += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }

        // Horizontal lines
        for (let y = 0; y < this.canvas.height; y += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }

    drawTracks() {
        this.ctx.strokeStyle = '#ffffff'; // 白い線路
        this.ctx.lineWidth = 3;
        this.ctx.shadowBlur = 5;
        this.ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';

        for (const section of this.config.sections) {
            const stations = section.stations || [];
            if (stations.length < 2) continue;

            this.ctx.beginPath();
            this.ctx.moveTo(stations[0].display_pos.x, stations[0].display_pos.y);

            for (let i = 1; i < stations.length; i++) {
                this.ctx.lineTo(stations[i].display_pos.x, stations[i].display_pos.y);
            }

            this.ctx.stroke();
        }

        this.ctx.shadowBlur = 0;
    }

    drawStations() {
        this.ctx.font = 'bold 14px Arial';

        for (const section of this.config.sections) {
            for (const station of section.stations || []) {
                const pos = station.display_pos;

                // Draw station marker (circle)
                this.ctx.beginPath();
                this.ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
                this.ctx.fillStyle = '#ffff00'; // 黄色
                this.ctx.fill();
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();

                // Draw station name below
                this.ctx.fillStyle = '#ffffff';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'top';
                this.ctx.fillText(station.name, pos.x, pos.y + 12);
            }
        }
    }

    drawTrains() {
        for (const train of this.trains) {
            this.drawTrain(train);
        }
    }

    drawTrain(train) {
        // Map game coordinates to display coordinates
        const displayPos = this.gameToDisplayCoords(train.position);

        // Choose color based on state and occupancy
        const color = this.getTrainColor(train);

        // Draw train box
        const boxWidth = 90;
        const boxHeight = 60;
        const x = displayPos.x - boxWidth / 2;
        const y = displayPos.y - boxHeight - 15; // Above the track

        // Shadow
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';

        // Box background
        this.ctx.fillStyle = color;
        this.roundRect(x, y, boxWidth, boxHeight, 5);
        this.ctx.fill();

        // Box border
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.roundRect(x, y, boxWidth, boxHeight, 5);
        this.ctx.stroke();

        this.ctx.shadowBlur = 0;

        // Train name
        this.ctx.fillStyle = '#000000';
        this.ctx.font = 'bold 13px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(train.name, displayPos.x, y + 15);

        // Schedule name
        this.ctx.font = '11px Arial';
        const scheduleName = train.schedule_name || `列車${train.id}`;
        this.ctx.fillText(scheduleName, displayPos.x, y + 32);

        // Occupancy bar
        const barWidth = boxWidth - 20;
        const barHeight = 6;
        const barX = x + 10;
        const barY = y + boxHeight - 15;

        // Bar background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.fillRect(barX, barY, barWidth, barHeight);

        // Bar fill
        const occupancyColor = this.getOccupancyColor(train.occupancy_percent);
        this.ctx.fillStyle = occupancyColor;
        const fillWidth = (train.occupancy_percent / 100) * barWidth;
        this.ctx.fillRect(barX, barY, fillWidth, barHeight);

        // Occupancy text
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '9px Arial';
        this.ctx.fillText(`${train.occupancy_percent}%`, displayPos.x, y + boxHeight - 3);
    }

    getTrainColor(train) {
        // 状態と乗車率で色を決定
        if (train.state === 'LOADING' || train.state === 'WAITING') {
            return '#FFA500'; // オレンジ（停車中）
        }
        if (train.occupancy_percent > 90) {
            return '#FF6B6B'; // 赤（高積載率）
        }
        return '#4CAF50'; // 緑（通常）
    }

    getOccupancyColor(percent) {
        if (percent > 90) return '#FF0000';  // 赤
        if (percent > 70) return '#FFA500';  // オレンジ
        if (percent > 50) return '#FFFF00';  // 黄色
        return '#00FF00';  // 緑
    }

    gameToDisplayCoords(gamePos) {
        // ゲーム座標を表示座標にマッピング
        // 最も近い駅を見つける
        let nearestStation = this.config.sections[0]?.stations[0];
        let minDist = Infinity;

        for (const section of this.config.sections) {
            for (const station of section.stations || []) {
                const dist = Math.sqrt(
                    Math.pow(station.game_pos.x - gamePos.x, 2) +
                    Math.pow(station.game_pos.y - gamePos.y, 2)
                );
                if (dist < minDist) {
                    minDist = dist;
                    nearestStation = station;
                }
            }
        }

        if (!nearestStation) {
            // デフォルト位置
            return { x: 300, y: 300 };
        }

        // 駅の近くにランダム配置（重ならないように）
        const offset = (this.trains.indexOf(this.trains.find(t =>
            t.position.x === gamePos.x && t.position.y === gamePos.y
        )) || 0) * 30;

        return {
            x: nearestStation.display_pos.x + offset,
            y: nearestStation.display_pos.y
        };
    }

    roundRect(x, y, width, height, radius) {
        // 角丸矩形を描画
        this.ctx.beginPath();
        this.ctx.moveTo(x + radius, y);
        this.ctx.lineTo(x + width - radius, y);
        this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        this.ctx.lineTo(x + width, y + height - radius);
        this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        this.ctx.lineTo(x + radius, y + height);
        this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        this.ctx.lineTo(x, y + radius);
        this.ctx.quadraticCurveTo(x, y, x + radius, y);
        this.ctx.closePath();
    }

    showError(title, message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.innerHTML = `
            <h2>${title}</h2>
            <p>${message}</p>
        `;
        document.body.appendChild(errorDiv);
    }
}

// Initialize on page load
window.addEventListener('load', () => {
    const display = new TiDDisplay();
    display.init();
});
