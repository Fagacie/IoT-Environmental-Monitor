// ===================================
// Modern IoT Dashboard - Professional Edition
// ===================================

// Configuration
const CONFIG = {
  channelId: 3216999,
  apiKey: 'G6OOCBLAPWKE8V2D',
  baseUrl: 'https://api.thingspeak.com/channels',
  updateInterval: 15 * 60 * 1000, // 15 minutes to match backend publishing
  chartUpdateInterval: 15 * 60 * 1000, // align chart refresh with sensor publish cadence
  staleThresholdMs: 20 * 60 * 1000, // stale if older than ~20 minutes on 15m cadence
  defaultRange: 60, // 1 hour in results
  maxRetries: 3,
  retryDelay: 2000,
  requestTimeout: 10000,
  // MQTT over WebSocket Configuration for ThingSpeak
  mqtt: {
    enabled: false, // Disabled: ThingSpeak MQTT port 8883 is for native clients, not browser WebSockets
    broker: 'mqtt3.thingspeak.com',
    port: 8883,
    protocol: 'wss', // WebSocket Secure
    clientId: 'JjwLBzs6HyMtCDgjKC4THTw',
    username: 'JjwLBzs6HyMtCDgjKC4THTw',
    password: 'VKEan+eJnTv8An9nj6fJJ5Lk',
    channelId: 3216999,
    topicSubscribe: 'channels/3216999/subscribe'
  },
  sensors: {
    temperature: { field: 'field1', unit: '°C', color: '#f59e0b', min: 15, max: 35, name: 'Temperature' },
    humidity: { field: 'field2', unit: '%', color: '#3b82f6', min: 30, max: 80, name: 'Humidity' },
    pressure: { field: 'field3', unit: 'hPa', color: '#8b5cf6', min: 980, max: 1040, name: 'Pressure' },
    waterLevel: { field: 'field4', unit: 'cm', color: '#06b6d4', min: 0, max: 100, name: 'Water Level' }
  }
};

// State Management
const STATE = {
  currentRange: 60,
  gaugeCharts: {},
  lineCharts: {},
  lastUpdate: null,
  theme: localStorage.getItem('theme') || 'light',
  activityLog: [],
  dataPointsToday: 0,
  isOnline: true,
  isLoading: false,
  connectionStatus: 'disconnected',
  lastError: null,
  retryCount: 0,
  mqttConnected: false,
  mqttClient: null,
  lastFeedCreatedAt: null,    // track last feed timestamp
  lastFeedChangeAt: null,     // when the feed timestamp last changed
  lastFeedSeenAt: null,       // when we last saw any feed (even if unchanged)
  statistics: {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    responseTimes: [],
    dataQuality: {
      temperature: { valid: 0, invalid: 0, outliers: 0 },
      humidity: { valid: 0, invalid: 0, outliers: 0 },
      pressure: { valid: 0, invalid: 0, outliers: 0 },
      waterLevel: { valid: 0, invalid: 0, outliers: 0 }
    }
  },
  alerts: [],
  dataHistory: {
    temperature: [],
    humidity: [],
    pressure: [],
    waterLevel: []
  },
  prevValues: {},
  userPreferences: JSON.parse(localStorage.getItem('userPreferences') || '{}')
};

// ===================================
// MQTT Service for Real-Time Updates
// ===================================
const MQTT = {
  init() {
    if (!CONFIG.mqtt.enabled || typeof mqtt === 'undefined') {
      console.log('MQTT disabled or library not available, using REST API polling');
      return;
    }

    try {
      const clientId = CONFIG.mqtt.clientId + '_' + Math.random().toString(16).substr(2, 8);
      const options = {
        clientId: clientId,
        username: CONFIG.mqtt.username,
        password: CONFIG.mqtt.password,
        clean: true,
        connectTimeout: 4000,
        reconnectPeriod: 5000,
        rejectUnauthorized: false
      };

      const url = `${CONFIG.mqtt.protocol}://${CONFIG.mqtt.broker}:${CONFIG.mqtt.port}`;
      console.log('Connecting to MQTT broker:', url);
      
      STATE.mqttClient = mqtt.connect(url, options);

      STATE.mqttClient.on('connect', () => {
        console.log('✅ MQTT Connected');
        STATE.mqttConnected = true;
        DeviceHealth.recordMQTTConnection();
        UI.addActivity('Real-time MQTT connected');
        
        // Subscribe to channel feed
        STATE.mqttClient.subscribe(CONFIG.mqtt.topicSubscribe, (err) => {
          if (err) {
            console.error('Subscribe error:', err);
          } else {
            console.log('Subscribed to:', CONFIG.mqtt.topicSubscribe);
            UI.addActivity('Subscribed to live sensor feed');
          }
        });
      });

      STATE.mqttClient.on('message', (topic, message) => {
        console.log('MQTT message received on', topic);
        DeviceHealth.recordMessageSent();
        this.handleMessage(message);
      });

      STATE.mqttClient.on('error', (error) => {
        console.error('MQTT error:', error);
        STATE.mqttConnected = false;
        DeviceHealth.recordMQTTDisconnection();
        UI.addActivity('MQTT connection error: ' + error.message, 'error');
      });

      STATE.mqttClient.on('disconnect', () => {
        console.log('MQTT disconnected');
        STATE.mqttConnected = false;
        DeviceHealth.recordMQTTDisconnection();
      });

    } catch (error) {
      console.error('MQTT initialization failed:', error);
      UI.addActivity('MQTT initialization failed, using REST API');
    }
  },

  handleMessage(message) {
    try {
      const payload = message.toString();
      console.log('Raw MQTT payload:', payload);
      
      // Parse field1=value&field2=value format
      const data = this.parseThingSpeakPayload(payload);
      
      if (data && (data.field1 || data.field2 || data.field3 || data.field4)) {
        console.log('Parsed MQTT data:', data);
        
        // Mark MQTT connection as active
        DeviceHealth.recordMQTTDataPoint();
        
        // Update UI with MQTT data
        if (data.field1) Gauges.update('temperature', data.field1);
        if (data.field2) Gauges.update('humidity', data.field2);
        if (data.field3) Gauges.update('pressure', data.field3);
        if (data.field4) Gauges.update('waterLevel', data.field4);
        
        // Record for health monitoring
        DeviceHealth.recordDataPoint({ created_at: new Date().toISOString(), ...data });
        
        STATE.lastUpdate = new Date();
        UI.addActivity('Real-time update via MQTT');
      }
    } catch (error) {
      console.error('Error handling MQTT message:', error);
    }
  },

  parseThingSpeakPayload(payload) {
    const data = {};
    const pairs = payload.split('&');
    pairs.forEach(pair => {
      const [key, value] = pair.split('=');
      if (key && value) {
        data[key] = parseFloat(value);
      }
    });
    return data;
  }
};

// ===================================
// API Service with Retry Logic & Error Handling
// ===================================
const API = {
  async fetchWithRetry(url, retries = CONFIG.maxRetries) {
    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.requestTimeout);
        
        const response = await fetch(url, { 
          signal: controller.signal,
          headers: {
            'Accept': 'application/json'
          },
          cache: 'no-store'
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Reset retry count on success
        STATE.retryCount = 0;
        STATE.connectionStatus = 'connected';
        this.updateConnectionStatus('connected');
        
        return data;
      } catch (error) {
        STATE.retryCount = i + 1;
        console.warn(`Request attempt ${i + 1} failed:`, error.message);
        
        if (i === retries - 1) {
          STATE.connectionStatus = 'error';
          this.updateConnectionStatus('error');
          throw error;
        }
        
        // Exponential backoff
        await this.delay(CONFIG.retryDelay * Math.pow(2, i));
      }
    }
  },
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  
  updateConnectionStatus(status) {
    const statusEl = document.getElementById('connectionStatus');
    const badgeDot = statusEl?.querySelector('.badge-dot');
    const badgeText = statusEl?.querySelector('.badge-text');
    
    if (!statusEl) return;
    
    statusEl.className = 'connection-badge';
    
    switch(status) {
      case 'connected':
        statusEl.classList.add('connected');
        if (badgeText) badgeText.textContent = 'Connected';
        break;
      case 'stale':
        statusEl.classList.add('error');
        if (badgeText) badgeText.textContent = 'Stale Data';
        break;
      case 'connecting':
        statusEl.classList.add('connecting');
        if (badgeText) badgeText.textContent = 'Connecting...';
        break;
      case 'error':
        statusEl.classList.add('error');
        if (badgeText) badgeText.textContent = 'Connection Error';
        break;
      default:
        if (badgeText) badgeText.textContent = 'Disconnected';
    }
  },
  
  async getLatestData() {
    const startTime = performance.now();
    STATE.statistics.totalRequests++;
    STATE.isLoading = true;
    this.updateConnectionStatus('connecting');
    
    try {
      const url = `${CONFIG.baseUrl}/${CONFIG.channelId}/feeds/last.json?api_key=${CONFIG.apiKey}&t=${Date.now()}`;
      console.log('Fetching latest data from:', url);
      
      const data = await this.fetchWithRetry(url);
      
      // Validate data
      if (!this.validateData(data)) {
        throw new Error('Invalid data received from API');
      }
      
      // Track performance
      const endTime = performance.now();
      const responseTime = endTime - startTime;
      this.trackPerformance(responseTime);
      
      STATE.statistics.successfulRequests++;
      STATE.lastError = null;
      STATE.isLoading = false;
      
      console.log('Latest data received:', data);
      return data;
    } catch (error) {
      STATE.statistics.failedRequests++;
      STATE.lastError = error.message;
      STATE.isLoading = false;
      console.error('Error fetching latest data:', error);
      
      UI.addActivity(`⚠️ API Error: ${error.message}`);
      ErrorHandler.handle(error, 'Failed to fetch latest data');
      
      throw error;
    }
  },

  async getHistoricalData(results = 60) {
    const startTime = performance.now();
    STATE.statistics.totalRequests++;
    
    try {
      const url = `${CONFIG.baseUrl}/${CONFIG.channelId}/feeds.json?results=${results}&api_key=${CONFIG.apiKey}&t=${Date.now()}`;
      console.log('Fetching historical data from:', url);
      
      const data = await this.fetchWithRetry(url);
      
      // Track performance
      const endTime = performance.now();
      const responseTime = endTime - startTime;
      this.trackPerformance(responseTime);
      
      STATE.statistics.successfulRequests++;
      console.log(`Historical data received: ${data.feeds?.length || 0} records`);
      return data.feeds || [];
    } catch (error) {
      STATE.statistics.failedRequests++;
      console.error('Error fetching historical data:', error);
      ErrorHandler.handle(error, 'Failed to fetch historical data');
      throw error;
    }
  },
  
  validateData(data) {
    if (!data || typeof data !== 'object') {
      console.error('Invalid data format');
      return false;
    }
    
    // Check if data is fresh (within last 5 minutes)
    if (data.created_at) {
      const dataAge = new Date() - new Date(data.created_at);
      if (dataAge > 300000) { // 5 minutes
        console.warn('Data is stale:', new Date(data.created_at));
      }
    }
    
    return true;
  },
  
  trackPerformance(responseTime) {
    STATE.statistics.responseTimes.push(responseTime);
    // Keep only last 50 measurements
    if (STATE.statistics.responseTimes.length > 50) {
      STATE.statistics.responseTimes.shift();
    }
    // Calculate average
    const sum = STATE.statistics.responseTimes.reduce((a, b) => a + b, 0);
    STATE.statistics.averageResponseTime = (sum / STATE.statistics.responseTimes.length).toFixed(2);
  }
};

// ===================================
// Gauge Charts
// ===================================
const Gauges = {
  init() {
    console.log('Initializing gauge charts...');
    Object.keys(CONFIG.sensors).forEach(sensor => {
      this.createGauge(sensor);
    });
  },

  createGauge(sensor) {
    const config = CONFIG.sensors[sensor];
    // Use full sensor names for clarity
    const sensorNames = {
      temperature: 'Temp',
      humidity: 'Hum',
      pressure: 'Pres',
      waterLevel: 'Water'
    };
    const canvasId = `gauge${sensorNames[sensor]}`;
    const ctx = document.getElementById(canvasId);
    
    if (!ctx) {
      console.error(`Canvas not found: ${canvasId}`);
      return;
    }

    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [0, 100],
          backgroundColor: [config.color, 'rgba(226, 232, 240, 0.2)'],
          borderWidth: 0,
          circumference: 270,
          rotation: 225
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1.5,
        cutout: '75%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      }
    });

    STATE.gaugeCharts[sensor] = chart;
    console.log(`Gauge created for ${sensor}`);
  },

  update(sensor, value) {
    const chart = STATE.gaugeCharts[sensor];
    const config = CONFIG.sensors[sensor];
    
    if (!chart || value === null || value === undefined) return;

    const numValue = parseFloat(value);
    const range = config.max - config.min;
    const percentage = ((numValue - config.min) / range) * 100;
    const displayPercentage = Math.max(0, Math.min(100, percentage));

    chart.data.datasets[0].data = [displayPercentage, 100 - displayPercentage];
    chart.update('none');

    // Update value display
    const sensorNames = {
      temperature: 'Temp',
      humidity: 'Hum',
      pressure: 'Pres',
      waterLevel: 'Water'
    };
    const valueId = `valu${sensorNames[sensor]}`;
    const valueElement = document.getElementById(valueId);
    if (valueElement) {
      valueElement.textContent = numValue.toFixed(1);
    }

    // Update status
    this.updateStatus(sensor, numValue, config);

    // Update delta since last reading
    this.updateDelta(sensor, numValue, config);
  },

  updateStatus(sensor, value, config) {
    const sensorNames = {
      temperature: 'Temp',
      humidity: 'Hum',
      pressure: 'Pres',
      waterLevel: 'Water'
    };
    const statusId = `status${sensorNames[sensor]}`;
    const statusElement = document.getElementById(statusId);
    
    if (!statusElement) return;

    // Remove all status classes
    statusElement.classList.remove('normal', 'warning', 'critical', 'status-normal', 'status-warning', 'status-critical');

    // Determine status
    const lowWarning = config.min + (config.max - config.min) * 0.1;
    const highWarning = config.max - (config.max - config.min) * 0.1;

    let statusText = 'Normal';
    let statusClass = 'status-normal';
    let healthKey = 'ok';

    if (value < config.min || value > config.max) {
      statusText = 'Critical';
      statusClass = 'status-critical';
      healthKey = 'crit';
    } else if (value < lowWarning || value > highWarning) {
      statusText = 'Warning';
      statusClass = 'status-warning';
      healthKey = 'warn';
    }

    statusElement.textContent = statusText;
    statusElement.classList.add(statusClass);

    // Update System Health chips
    if (typeof UI.updateSystemHealth === 'function') {
      UI.updateSystemHealth(sensor, statusText, healthKey);
    }
  },

  updateDelta(sensor, value, config) {
    const prev = STATE.prevValues[sensor];
    const deltaEl = document.getElementById(`delta${{
      temperature: 'Temp',
      humidity: 'Hum',
      pressure: 'Pres',
      waterLevel: 'Water'
    }[sensor]}`);
    if (!deltaEl) return;

    if (prev === undefined) {
      deltaEl.textContent = '—';
      deltaEl.className = 'gauge-delta neutral';
    } else {
      const diff = value - prev;
      const sign = diff > 0 ? '+' : diff < 0 ? '' : '';
      const magnitude = Math.abs(diff) < 0.01 ? 0 : diff;
      deltaEl.textContent = magnitude === 0 ? 'No change' : `${sign}${diff.toFixed(2)} ${config.unit}`;
      deltaEl.className = 'gauge-delta ' + (diff > 0.01 ? 'positive' : diff < -0.01 ? 'negative' : 'neutral');
    }

    STATE.prevValues[sensor] = value;
  }
};

// ===================================
// Line Charts
// ===================================
const Charts = {
  init() {
    console.log('Initializing line charts...');
    Object.keys(CONFIG.sensors).forEach(sensor => {
      this.createChart(sensor);
    });
    // Initialize sparklines after charts
    if (typeof Sparkline !== 'undefined') Sparkline.init();
  },

  createChart(sensor) {
    const config = CONFIG.sensors[sensor];
    const sensorNames = {
      temperature: 'Temp',
      humidity: 'Hum',
      pressure: 'Pres',
      waterLevel: 'Water'
    };
    const canvasId = `chart${sensorNames[sensor]}`;
    const ctx = document.getElementById(canvasId);
    
    if (!ctx) {
      console.error(`Canvas not found: ${canvasId}`);
      return;
    }

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          label: sensor.charAt(0).toUpperCase() + sensor.slice(1),
          data: [],
          borderColor: config.color,
          backgroundColor: config.color + '20',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleColor: '#fff',
            bodyColor: '#fff',
            callbacks: {
              label: (context) => `${context.parsed.y.toFixed(2)} ${config.unit}`
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'minute',
              displayFormats: {
                minute: 'HH:mm',
                hour: 'HH:mm'
              }
            },
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            },
            ticks: {
              color: getComputedStyle(document.documentElement)
                .getPropertyValue('--text-secondary').trim()
            }
          },
          y: {
            beginAtZero: false,
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            },
            ticks: {
              color: getComputedStyle(document.documentElement)
                .getPropertyValue('--text-secondary').trim(),
              callback: (value) => value.toFixed(1) + config.unit
            }
          }
        }
      }
    });

    STATE.lineCharts[sensor] = chart;
    console.log(`Line chart created for ${sensor}`);
  },

  async updateAll(range = STATE.currentRange) {
    console.log(`Updating all charts with ${range} results...`);
    try {
      const feeds = await API.getHistoricalData(range);
      
      Object.keys(CONFIG.sensors).forEach(sensor => {
        this.updateChart(sensor, feeds);
      });

      // Update sparklines with the same feeds
      if (typeof Sparkline !== 'undefined') Sparkline.updateFromFeeds(feeds);
    } catch (error) {
      console.error('Error updating charts:', error);
    }
  },

  updateChart(sensor, feeds) {
    const chart = STATE.lineCharts[sensor];
    const config = CONFIG.sensors[sensor];
    
    if (!chart) return;

    const data = feeds
      .filter(feed => feed[config.field] !== null)
      .map(feed => ({
        x: new Date(feed.created_at),
        y: parseFloat(feed[config.field])
      }));

    console.log(`Updating ${sensor} chart with ${data.length} points`);
    // Dynamically set time unit based on data density/length
    let unit = 'minute';
    if (data.length > 200) unit = 'hour';
    if (data.length > 2000) unit = 'day';
    if (chart.options && chart.options.scales && chart.options.scales.x && chart.options.scales.x.time) {
      chart.options.scales.x.time.unit = unit;
      chart.options.scales.x.time.displayFormats = {
        minute: 'HH:mm',
        hour: 'MMM d, HH:mm',
        day: 'MMM d'
      };
    }
    
    chart.data.datasets[0].data = data;
    chart.update('none');
  }
};

// ===================================
// Mini Sparklines under Gauges
// ===================================
const Sparkline = {
  charts: {},
  maxPoints: 32,
  idMap: {
    temperature: 'sparkTemp',
    humidity: 'sparkHum',
    pressure: 'sparkPres',
    waterLevel: 'sparkWater'
  },

  init() {
    console.log('Initializing sparklines...');
    Object.keys(CONFIG.sensors).forEach(sensor => this.create(sensor));
  },

  create(sensor) {
    const canvasId = this.idMap[sensor];
    const cfg = CONFIG.sensors[sensor];
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined') return;

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: cfg.color,
          backgroundColor: cfg.color + '22',
          borderWidth: 1.5,
          fill: true,
          tension: 0.35,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        animation: false
      }
    });

    this.charts[sensor] = chart;
  },

  updateFromFeeds(feeds) {
    if (!Array.isArray(feeds)) return;
    Object.keys(CONFIG.sensors).forEach(sensor => {
      const field = CONFIG.sensors[sensor].field;
      const values = feeds
        .map(f => (f && f[field] != null ? parseFloat(f[field]) : null))
        .filter(v => Number.isFinite(v));
      const last = values.slice(-this.maxPoints);
      this.setData(sensor, last);
    });
  },

  appendLatest(data) {
    if (!data) return;
    Object.keys(CONFIG.sensors).forEach(sensor => {
      const field = CONFIG.sensors[sensor].field;
      const raw = data[field];
      if (!Number.isFinite(parseFloat(raw))) return;
      const chart = this.charts[sensor];
      if (!chart) return;
      const ds = chart.data.datasets[0].data;
      ds.push(parseFloat(raw));
      while (ds.length > this.maxPoints) ds.shift();
      // keep labels length in sync for category axis
      const labels = chart.data.labels;
      labels.push('');
      while (labels.length > ds.length) labels.shift();
      chart.update('none');
    });
  },

  setData(sensor, arr) {
    const chart = this.charts[sensor];
    if (!chart) return;
    chart.data.datasets[0].data = arr;
    chart.data.labels = Array(arr.length).fill('');
    chart.update('none');
  }
};

// ===================================
// UI Updates
// ===================================
const UI = {
  async updateLiveData() {
    try {
      const data = await API.getLatestData();
      
      if (!data || !data.created_at) {
        console.error('Invalid data received');
        this.setConnectionStatus('disconnected');
        return;
      }

      // Check data age immediately - if older than 1.2x interval (~18 min), mark offline
      const lastUpdate = new Date(data.created_at);
      const ageMs = Date.now() - lastUpdate.getTime();
      const maxAgeMs = CONFIG.updateInterval * 1.2; // ~18 minutes for 15-minute cadence
      
      if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) {
        this.setConnectionStatus('disconnected');
        this.addActivity(`Device offline: last data ${Math.floor(ageMs / 60000)} minutes old`);
        return;
      }

      // Detect frozen feed (timestamp not changing)
      const createdAtStr = data.created_at;
      const nowMs = Date.now();
      const freezeThreshold = CONFIG.updateInterval * 2; // 10 minutes

      // Track when the feed timestamp last changed
      if (!STATE.lastFeedCreatedAt || STATE.lastFeedCreatedAt !== createdAtStr) {
        STATE.lastFeedCreatedAt = createdAtStr;
        STATE.lastFeedChangeAt = nowMs;
      }
      STATE.lastFeedSeenAt = nowMs;

      const noChangeDuration = STATE.lastFeedChangeAt ? (nowMs - STATE.lastFeedChangeAt) : 0;

      if (noChangeDuration > freezeThreshold) {
        this.setConnectionStatus('disconnected');
        this.addActivity('Device offline: no new entries detected');
        return;
      }

      // Update each gauge
      Gauges.update('temperature', data.field1);
      Gauges.update('humidity', data.field2);
      Gauges.update('pressure', data.field3);
      Gauges.update('waterLevel', data.field4);

      // Update sparklines with the latest point
      if (typeof Sparkline !== 'undefined') Sparkline.appendLatest(data);

      // Record data for health monitoring
      DeviceHealth.recordDataPointFromREST();
      DeviceHealth.recordDataPoint(data);
      
      // Update last update time
      STATE.lastUpdate = lastUpdate;
      const lastUpdateEl = document.getElementById('lastUpdate');
      if (lastUpdateEl) {
        lastUpdateEl.textContent = lastUpdate.toLocaleTimeString();
      }

      // Increment data points counter
      STATE.dataPointsToday++;
      const dataPointsEl = document.getElementById('dataPoints');
      if (dataPointsEl) {
        dataPointsEl.textContent = STATE.dataPointsToday;
      }

      // Add to activity log
      this.addActivity(`Data updated: T=${data.field1}°C, H=${data.field2}%`);

      // Cache last successful reading
      if (typeof Cache !== 'undefined') Cache.save(data);

      this.setConnectionStatus('connected');
    } catch (error) {
      console.error('Error updating live data:', error);
      this.setConnectionStatus('disconnected');
      this.addActivity('Error: Connection failed', 'error');
    }
  },

  async updateDataPointsToday() {
    try {
      // Fetch a larger window to capture today's points (up to ~41 hours at 5m cadence)
      const feeds = await API.getHistoricalData(500);
      const today = new Date().toISOString().slice(0, 10);
      const countToday = feeds.filter(f => f.created_at && f.created_at.startsWith(today)).length;
      STATE.dataPointsToday = countToday;
      const el = document.getElementById('dataPoints');
      if (el) el.textContent = countToday;
    } catch (error) {
      console.error('Error updating data points count:', error);
    }
  },

  setConnectionStatus(status) {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;

    statusEl.className = `connection-badge ${status}`;
    
    const statusText = {
      connected: 'Connected',
      stale: 'Waiting for Data',
      disconnected: 'No Data'
    };

    const textEl = statusEl.querySelector('.badge-text');
    if (textEl) {
      textEl.textContent = statusText[status] || 'Unknown';
    }

    // Update API status
    const apiStatusEl = document.getElementById('apiStatus');
    if (apiStatusEl) {
      if (status === 'connected') {
        apiStatusEl.textContent = 'Online';
        apiStatusEl.style.color = 'var(--success)';
      } else if (status === 'stale') {
        apiStatusEl.textContent = 'Waiting (No new data in 10+ min)';
        apiStatusEl.style.color = '#f59e0b';  // Warning color
      } else {
        apiStatusEl.textContent = 'Offline (No data)';
        apiStatusEl.style.color = 'var(--danger)';
      }
    }
  },

  setupTimeRangeButtons() {
    const buttons = document.querySelectorAll('.time-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', async () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const range = parseInt(btn.dataset.range);
        STATE.currentRange = range;
        await Charts.updateAll(range);
        
        this.addActivity(`Chart range changed to ${btn.querySelector('.time-label').textContent}`);
      });
    });
  },

  updateClock() {
    const now = new Date();
    
    // Update time
    const timeEl = document.getElementById('currentTime');
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    
    // Update date
    const dateEl = document.getElementById('currentDate');
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  },

  addActivity(text, type = 'info') {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    
    STATE.activityLog.unshift({ time: timeStr, text, type });
    
    // Keep only last 10 items
    if (STATE.activityLog.length > 10) {
      STATE.activityLog = STATE.activityLog.slice(0, 10);
    }
    
    this.renderActivityLog();
  },

  renderActivityLog() {
    const logEl = document.getElementById('activityLog');
    if (!logEl) return;
    
    logEl.innerHTML = STATE.activityLog.map(item => `
      <div class="activity-item">
        <span class="activity-time">${item.time}</span>
        <span class="activity-text">${item.text}</span>
      </div>
    `).join('');
  },

  // Watchdog: mark connection stale/disconnected if no fresh data arrives
  checkStaleness() {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;

    if (!STATE.lastUpdate) {
      this.setConnectionStatus('disconnected');
      return;
    }

    const ageMs = Date.now() - STATE.lastUpdate.getTime();
    if (!Number.isFinite(ageMs)) {
      this.setConnectionStatus('disconnected');
      return;
    }

    if (ageMs > CONFIG.staleThresholdMs) {
      this.setConnectionStatus('stale');
      this.addActivity('No new data detected (stale)');
    }
  },

  setupRefreshButton() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.style.opacity = '0.6';
        
        await this.updateLiveData();
        await Charts.updateAll(STATE.currentRange);
        this.addActivity('Manual refresh completed');
        
        setTimeout(() => {
          refreshBtn.disabled = false;
          refreshBtn.style.opacity = '1';
        }, 2000);
      });
    }
  }
};

// Extra UI helpers
UI.updateSystemHealth = function(sensor, statusText, healthKey) {
  const idMap = {
    temperature: 'sysHealth-temperature',
    humidity: 'sysHealth-humidity',
    pressure: 'sysHealth-pressure',
    waterLevel: 'sysHealth-waterLevel'
  };
  const el = document.getElementById(idMap[sensor]);
  if (!el) return;
  const ind = el.querySelector('.health-indicator');
  const st = el.querySelector('.health-status');
  if (ind) {
    ind.classList.remove('ok', 'warn', 'crit', 'active');
    ind.classList.add(healthKey === 'ok' ? 'ok' : healthKey === 'warn' ? 'warn' : 'crit');
  }
  if (st) {
    st.classList.remove('ok', 'warn', 'crit');
    st.classList.add(healthKey === 'ok' ? 'ok' : healthKey === 'warn' ? 'warn' : 'crit');
    st.textContent = statusText;
  }
};

UI.setupExportButtons = function() {
  const csvBtn = document.getElementById('exportCsvBtn');
  const jsonBtn = document.getElementById('exportJsonBtn');
  if (csvBtn) csvBtn.addEventListener('click', () => DataExport.exportToCSV());
  if (jsonBtn) jsonBtn.addEventListener('click', () => DataExport.exportToJSON());
};

// ===================================
// Theme Management
// ===================================
const Theme = {
  init() {
    // Apply saved theme
    document.documentElement.setAttribute('data-theme', STATE.theme);
    this.updateThemeIcon();
    
    // Setup toggle button
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.addEventListener('click', () => this.toggle());
    }

    // Apply saved density
    const savedDensity = localStorage.getItem('density') || 'comfortable';
    document.documentElement.setAttribute('data-density', savedDensity);
  },

  toggle() {
    STATE.theme = STATE.theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', STATE.theme);
    localStorage.setItem('theme', STATE.theme);
    this.updateThemeIcon();
    
    // Update chart colors
    Object.values(STATE.lineCharts).forEach(chart => {
      if (chart) chart.update('none');
    });
    
    UI.addActivity(`Theme changed to ${STATE.theme} mode`);
  },

  updateThemeIcon() {
    const iconEl = document.getElementById('themeIcon');
    if (iconEl) {
      // Update SVG icon for theme
      const isDark = STATE.theme === 'dark';
      iconEl.innerHTML = isDark 
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }
  }
};

// Density toggle (compact/comfortable)
UI.setupDensityToggle = function() {
  const btn = document.getElementById('densityToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-density') || 'comfortable';
    const next = current === 'compact' ? 'comfortable' : 'compact';
    document.documentElement.setAttribute('data-density', next);
    localStorage.setItem('density', next);
    UI.addActivity(`View density set to ${next}`);
  });
};

// ===================================
// Device Health Monitoring Module
// ===================================
const DeviceHealth = {
  state: {
    mqttConnected: false,
    connectTime: null,
    messagesSent: 0,
    failedTransmissions: 0,
    lastDataTime: null,
    responseTimes: [],
    dataSource: 'none' // 'mqtt', 'rest', or 'none'
  },

  init() {
    console.log('Initializing Device Health Monitor...');
    this.startUptimeTracker();
    this.setupEventListeners();
  },

  startUptimeTracker() {
    setInterval(() => this.updateUptime(), 1000);
  },

  updateUptime() {
    if (!this.state.connectTime) return;
    
    const now = Date.now();
    const uptimeMs = now - this.state.connectTime;
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    
    const uptimeEl = document.getElementById('uptimeValue');
    if (uptimeEl) uptimeEl.textContent = `${hours}h ${minutes}m`;
  },

  recordMQTTConnection() {
    this.state.mqttConnected = true;
    if (!this.state.connectTime) {
      this.state.connectTime = Date.now();
    }
    this.state.dataSource = 'mqtt';
    this.updateConnectionStatus('Connected', 'MQTT');
    UI.addActivity('Device Health: MQTT connected');
  },

  recordMQTTDisconnection() {
    this.state.mqttConnected = false;
    if (this.state.dataSource === 'mqtt') {
      this.state.dataSource = 'none';
    }
  },

  recordMQTTDataPoint() {
    // Called when MQTT message received - marks MQTT as active data source
    if (!this.state.connectTime) {
      this.state.connectTime = Date.now();
    }
    this.state.dataSource = 'mqtt';
    this.updateConnectionStatus('Connected', 'MQTT');
  },

  recordDataPointFromREST() {
    // When REST API provides data, mark as connected via REST
    if (!this.state.connectTime) {
      this.state.connectTime = Date.now();
    }
    if (this.state.dataSource !== 'mqtt') {
      this.state.dataSource = 'rest';
    }
    this.updateConnectionStatus('Connected', 'REST API');
  },

  updateConnectionStatus(status, source) {
    const statusEl = document.getElementById('mqttStatus');
    const badgeEl = document.getElementById('mqttStatusBadge');
    const timeEl = document.getElementById('mqttTime');
    
    if (statusEl) statusEl.textContent = `${status} (${source})`;
    if (badgeEl) {
      badgeEl.className = 'badge success';
      badgeEl.textContent = 'Online';
    }
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();
  },

  recordMessageSent() {
    this.state.messagesSent++;
    const el = document.getElementById('messagesSent');
    if (el) el.textContent = this.state.messagesSent;
  },

  recordFailedTransmission() {
    this.state.failedTransmissions++;
    const el = document.getElementById('failedTransmissions');
    if (el) el.textContent = this.state.failedTransmissions;
  },

  recordDataPoint(data) {
    this.state.lastDataTime = new Date(data.created_at || Date.now());
    const lastEl = document.getElementById('lastDataPoint');
    const timeEl = document.getElementById('lastDataTime');
    const ageSeconds = Math.floor((Date.now() - this.state.lastDataTime) / 1000);
    
    if (lastEl) lastEl.textContent = this.state.lastDataTime.toLocaleTimeString();
    if (timeEl) {
      if (ageSeconds < 60) {
        timeEl.textContent = `${ageSeconds}s ago`;
      } else if (ageSeconds < 3600) {
        timeEl.textContent = `${Math.floor(ageSeconds / 60)}m ${ageSeconds % 60}s ago`;
      } else {
        timeEl.textContent = `${Math.floor(ageSeconds / 3600)}h ago`;
      }
    }
    
    // Warn if data is older than update interval
    if (ageSeconds > 600) { // 10 minutes
      const warning = document.getElementById('dataAgeWarning');
      if (warning) {
        warning.style.display = 'block';
        warning.textContent = `⚠️ No data for ${Math.floor(ageSeconds / 60)} minutes - Check if Pico is powered on`;
      }
    }
  },

  recordLatency(ms) {
    this.state.responseTimes.push(ms);
    if (this.state.responseTimes.length > 100) {
      this.state.responseTimes.shift();
    }
    
    const avg = Math.round(this.state.responseTimes.reduce((a, b) => a + b, 0) / this.state.responseTimes.length);
    const el = document.getElementById('apiLatency');
    if (el) el.textContent = `${avg}ms`;
  },

  setupEventListeners() {
    // MQTT connection will trigger these
  }
};

// ===================================
// App Initialization
// ===================================
const TrendAnalysis = {
  state: {
    dataStore: {
      temperature: [],
      humidity: [],
      pressure: [],
      waterLevel: []
    },
    period: 7 // days
  },

  init() {
    console.log('Initializing Trend Analysis...');
    this.setupUI();
  },

  setupUI() {
    const periodSelect = document.getElementById('trendPeriod');
    if (periodSelect) {
      periodSelect.addEventListener('change', (e) => {
        this.state.period = parseInt(e.target.value);
        this.updateTrends();
      });
    }
  },

  storeDataPoint(sensorType, value) {
    if (!this.state.dataStore[sensorType]) return;
    
    this.state.dataStore[sensorType].push({
      value: value,
      timestamp: Date.now()
    });
    
    // Keep only data for the longest period (90 days)
    const cutoffTime = Date.now() - (90 * 24 * 60 * 60 * 1000);
    this.state.dataStore[sensorType] = this.state.dataStore[sensorType].filter(
      d => d.timestamp > cutoffTime
    );
  },

  updateTrends() {
    const cutoffTime = Date.now() - (this.state.period * 24 * 60 * 60 * 1000);
    
    ['temperature', 'humidity', 'pressure', 'waterLevel'].forEach(sensor => {
      const data = this.state.dataStore[sensor].filter(d => d.timestamp > cutoffTime);
      if (data.length === 0) return;
      
      const values = data.map(d => d.value);
      const current = values[values.length - 1];
      const avg = values.reduce((a, b) => a + b) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      
      const rateOfChange = this.calculateRateOfChange(data);
      const trend = this.detectTrend(data);
      const anomalies = this.detectAnomalies(values);
      
      this.displayTrend(sensor, { current, avg, min, max, rateOfChange, trend, anomalies });
    });
  },

  calculateRateOfChange(data) {
    if (data.length < 2) return 0;
    
    const oldValue = data[0].value;
    const newValue = data[data.length - 1].value;
    const timeSpanDays = (data[data.length - 1].timestamp - data[0].timestamp) / (24 * 60 * 60 * 1000);
    
    return ((newValue - oldValue) / timeSpanDays).toFixed(2);
  },

  detectTrend(data) {
    if (data.length < 3) return 'stable';
    
    const recent = data.slice(-5).map(d => d.value);
    const avg = recent.reduce((a, b) => a + b) / recent.length;
    const older = data.slice(0, 5).map(d => d.value);
    const oldAvg = older.reduce((a, b) => a + b) / older.length;
    
    const change = avg - oldAvg;
    if (change > 0.5) return 'up';
    if (change < -0.5) return 'down';
    return 'stable';
  },

  detectAnomalies(values) {
    const mean = values.reduce((a, b) => a + b) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return values.filter(v => Math.abs(v - mean) > 3 * stdDev);
  },

  displayTrend(sensor, stats) {
    const units = {
      temperature: '°C',
      humidity: '%',
      pressure: 'hPa',
      waterLevel: 'cm'
    };
    
    const unit = units[sensor] || '';
    const trendDir = stats.trend === 'up' ? '↑' : stats.trend === 'down' ? '↓' : '→';
    const trendClass = stats.trend === 'up' ? 'up' : stats.trend === 'down' ? 'down' : 'stable';
    
    const updateUI = (elementId, value) => {
      const el = document.getElementById(elementId);
      if (el) el.textContent = value;
    };
    
    updateUI(`trend${sensor.charAt(0).toUpperCase() + sensor.slice(1)}Current`, `${stats.current.toFixed(1)}${unit}`);
    updateUI(`trend${sensor.charAt(0).toUpperCase() + sensor.slice(1)}Avg`, `${stats.avg.toFixed(1)}${unit}`);
    updateUI(`trend${sensor.charAt(0).toUpperCase() + sensor.slice(1)}Range`, `${stats.min.toFixed(1)} / ${stats.max.toFixed(1)}${unit}`);
    
    const dirEl = document.getElementById(`trend${sensor.charAt(0).toUpperCase() + sensor.slice(1)}Dir`);
    if (dirEl) {
      dirEl.textContent = trendDir;
      dirEl.className = `trend-indicator ${trendClass}`;
    }
    
    updateUI(`trend${sensor.charAt(0).toUpperCase() + sensor.slice(1)}Rate`, `${stats.rateOfChange}${unit}/day`);
    
    if (stats.anomalies.length > 0) {
      this.displayAnomalies(sensor, stats.anomalies);
    }
  },

  displayAnomalies(sensor, anomalies) {
    const list = document.getElementById('anomalyList');
    if (!list || anomalies.length === 0) return;
    
    if (list.querySelector('.no-anomalies')) {
      list.innerHTML = '';
    }
    
    anomalies.forEach(value => {
      const item = document.createElement('div');
      item.className = 'anomaly-item';
      item.innerHTML = `
        <div class="anomaly-label">⚠️ Anomaly Detected</div>
        <div class="anomaly-detail">${sensor}: ${value.toFixed(2)} (unusual value)</div>
      `;
      list.appendChild(item);
    });
  }
};

// ===================================
// App Initialization
// ===================================
const App = {
  async init() {
    console.log('🚀 Initializing IoT Dashboard...');
    
    try {
      // Initialize theme
      Theme.init();
      
      // Initialize advanced modules
      DeviceHealth.init();
      // AlertManager and TrendAnalysis removed - UI sections deleted
      
      // Initialize MQTT for real-time updates
      MQTT.init();
      
      // Initialize charts
      Gauges.init();
      // Apply Chart.js defaults for professional theme
      if (typeof Chart !== 'undefined') {
        Chart.defaults.font.family = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#64748b';
        Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.15)';
        Chart.defaults.plugins.legend.labels.usePointStyle = true;
      }
      Charts.init();
      
      // Setup UI controls
      UI.setupTimeRangeButtons();
      UI.setupRefreshButton();
      UI.setupDensityToggle();
      UI.setupExportButtons();
      
      // Start clock
      UI.updateClock();
      setInterval(() => UI.updateClock(), 1000);
      
      // Initial activity log entry
      UI.addActivity('Dashboard initialized successfully');
      
      // Preload from cache (instant render)
      try {
        const cached = typeof Cache !== 'undefined' ? Cache.load() : null;
        if (cached && cached.created_at) {
          Gauges.update('temperature', cached.field1);
          Gauges.update('humidity', cached.field2);
          Gauges.update('pressure', cached.field3);
          Gauges.update('waterLevel', cached.field4);
          if (typeof Sparkline !== 'undefined') Sparkline.appendLatest(cached);
          const lastUpdateEl = document.getElementById('lastUpdate');
          if (lastUpdateEl) lastUpdateEl.textContent = new Date(cached.created_at).toLocaleTimeString();
          UI.setConnectionStatus('stale');
          UI.addActivity('Loaded last reading from cache');
        }
      } catch {}
      
      // Initial data load
      console.log('Loading initial data...');
      await UI.updateLiveData();
      await Charts.updateAll(STATE.currentRange);
      await UI.updateDataPointsToday();
      
      // Setup update intervals
      setInterval(() => UI.updateLiveData(), CONFIG.updateInterval);
      setInterval(() => Charts.updateAll(STATE.currentRange), CONFIG.chartUpdateInterval);
      setInterval(() => UI.updateDataPointsToday(), 15 * 60 * 1000);
      // Watchdog to downgrade status if data stops arriving
      UI.checkStaleness();
      setInterval(() => UI.checkStaleness(), 30000);
      
      console.log('✅ Dashboard initialized successfully!');
    } catch (error) {
      console.error('Initialization error:', error);
      UI.addActivity('⚠️ Dashboard initialization error');
    }
  },
  
  // Initialize advanced features after main app is ready
  initAdvancedFeatures() {
    try {
      if (typeof Analytics !== 'undefined') Analytics.init();
      if (typeof DataExport !== 'undefined') DataExport.init();
      if (typeof Notifications !== 'undefined') Notifications.init();
      if (typeof Accessibility !== 'undefined') Accessibility.init();
      if (typeof PerformanceMonitor !== 'undefined') PerformanceMonitor.start();
    } catch (error) {
      console.warn('Advanced features initialization error:', error);
    }
  }
};

// ===================================
// Analytics & Statistics
// ===================================
const Analytics = {
  init() {
    console.log('📊 Analytics module initialized');
    // Update statistics display every 30 seconds
    setInterval(() => this.updateStatistics(), 30000);
  },
  
  updateStatistics() {
    // Calculate uptime
    const uptime = this.calculateUptime();
    
    // Calculate success rate
    const successRate = STATE.statistics.totalRequests > 0 
      ? ((STATE.statistics.successfulRequests / STATE.statistics.totalRequests) * 100).toFixed(1)
      : 0;
    
    console.log('📈 Statistics:', {
      totalRequests: STATE.statistics.totalRequests,
      successRate: `${successRate}%`,
      avgResponseTime: `${STATE.statistics.averageResponseTime}ms`,
      uptime: uptime
    });
  },
  
  calculateUptime() {
    if (!STATE.lastUpdate) return '0m';
    const now = new Date();
    const diff = now - new Date(STATE.lastUpdate);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  },
  
  getSensorTrend(sensor) {
    const history = STATE.dataHistory[sensor];
    if (history.length < 2) return 'stable';
    
    const recent = history.slice(-5);
    const increasing = recent.every((val, idx) => idx === 0 || val >= recent[idx - 1]);
    const decreasing = recent.every((val, idx) => idx === 0 || val <= recent[idx - 1]);
    
    if (increasing) return 'increasing';
    if (decreasing) return 'decreasing';
    return 'fluctuating';
  }
};

// ===================================
// Data Export & Download
// ===================================
const DataExport = {
  init() {
    console.log('💾 Data export module initialized');
    this.setupKeyboardShortcuts();
  },
  
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+S or Cmd+S to export data
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.exportToCSV();
      }
      // Ctrl+P or Cmd+P to print
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        window.print();
      }
    });
  },
  
  async exportToCSV() {
    try {
      const data = await API.getHistoricalData(1000);
      if (!data || data.length === 0) {
        UI.addActivity('No data available to export');
        return;
      }
      
      // Create CSV content
      const headers = ['Timestamp', 'Temperature (°C)', 'Humidity (%)', 'Pressure (hPa)', 'Water Level (cm)'];
      const rows = data.map(entry => [
        entry.created_at,
        entry.field1 || '',
        entry.field2 || '',
        entry.field3 || '',
        entry.field4 || ''
      ]);
      
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\\n');
      
      // Download file
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `iot-data-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      UI.addActivity('Data exported successfully to CSV');
      console.log('✅ Data exported to CSV');
    } catch (error) {
      console.error('Export failed:', error);
      UI.addActivity('Export failed - please try again');
    }
  },
  
  exportToJSON() {
    const exportData = {
      timestamp: new Date().toISOString(),
      statistics: STATE.statistics,
      dataHistory: STATE.dataHistory,
      configuration: CONFIG
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iot-session-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    UI.addActivity('Session data exported to JSON');
  }
};

// ===================================
// Smart Notifications & Alerts
// ===================================
const Notifications = {
  init() {
    console.log('🔔 Notifications module initialized');
    this.requestPermission();
  },
  
  requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          console.log('✅ Notification permission granted');
          UI.addActivity('Browser notifications enabled');
        }
      });
    }
  },
  
  send(title, body, type = 'info') {
    // Browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body: body,
        icon: type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️',
        tag: 'iot-dashboard'
      });
    }
    
    // Log alert
    STATE.alerts.push({
      time: new Date().toISOString(),
      title: title,
      body: body,
      type: type
    });
    
    // Keep only last 20 alerts
    if (STATE.alerts.length > 20) {
      STATE.alerts = STATE.alerts.slice(-20);
    }
  },
  
  checkThresholds(sensor, value) {
    const config = CONFIG.sensors[sensor];
    if (!config) return;
    
    const sensorName = sensor.charAt(0).toUpperCase() + sensor.slice(1);
    
    if (value < config.min) {
      this.send(
        `${sensorName} Alert`,
        `${sensorName} is critically low: ${value} ${config.unit}`,
        'error'
      );
      UI.addActivity(`⚠️ ${sensorName} below minimum threshold`);
    } else if (value > config.max) {
      this.send(
        `${sensorName} Alert`,
        `${sensorName} is critically high: ${value} ${config.unit}`,
        'error'
      );
      UI.addActivity(`⚠️ ${sensorName} above maximum threshold`);
    }
  }
};

// ===================================
// Performance Monitor
// ===================================
const PerformanceMonitor = {
  metrics: {
    fps: 0,
    memory: 0,
    apiLatency: 0
  },
  
  start() {
    console.log('⚡ Performance monitoring started');
    
    // Monitor memory usage (if available)
    if (performance.memory) {
      setInterval(() => {
        this.metrics.memory = (performance.memory.usedJSHeapSize / 1048576).toFixed(2);
      }, 5000);
    }
    
    // Log performance metrics
    setInterval(() => {
      console.log('⚡ Performance:', {
        apiLatency: `${STATE.statistics.averageResponseTime}ms`,
        memory: `${this.metrics.memory}MB`,
        totalRequests: STATE.statistics.totalRequests,
        successRate: `${((STATE.statistics.successfulRequests / STATE.statistics.totalRequests) * 100).toFixed(1)}%`
      });
    }, 60000); // Every minute
  }
};

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await App.init();
    // Initialize advanced features after main app is ready
    setTimeout(() => App.initAdvancedFeatures(), 1000);
  });
} else {
  App.init().then(() => {
    // Initialize advanced features after main app is ready
    setTimeout(() => App.initAdvancedFeatures(), 1000);
  });
}

// ===================================
// Error Handler with User Feedback
// ===================================
const ErrorHandler = {
  handle(error, userMessage = 'An error occurred') {
    console.error('Error:', error);
    
    // Log to STATE for debugging
    STATE.lastError = {
      message: error.message,
      time: new Date().toISOString(),
      userMessage: userMessage
    };
    
    // Show user-friendly error message
    this.showErrorToast(userMessage);
    
    // Log to activity
    UI.addActivity(`❌ ${userMessage}`);
  },
  
  showErrorToast(message) {
    // Create toast element if it doesn't exist
    let toast = document.getElementById('errorToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'errorToast';
      toast.className = 'error-toast';
      document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 5000);
  }
};

// ===================================
// Local Cache (last reading)
// ===================================
const Cache = {
  key: 'iot:lastReading',
  save(data) {
    try { localStorage.setItem(this.key, JSON.stringify(data)); } catch (e) { /* ignore */ }
  },
  load() {
    try { return JSON.parse(localStorage.getItem(this.key) || 'null'); } catch { return null; }
  }
};

// ===================================
// Data Validation & Quality Control
// ===================================
const DataValidator = {
  validate(sensor, value) {
    const config = CONFIG.sensors[sensor];
    const numValue = parseFloat(value);
    
    // Check if value is a number
    if (isNaN(numValue)) {
      STATE.statistics.dataQuality[sensor].invalid++;
      console.warn(`Invalid ${sensor} value:`, value);
      return { valid: false, reason: 'Not a number' };
    }
    
    // Check for outliers (beyond expected range)
    const isOutlier = this.isOutlier(sensor, numValue);
    if (isOutlier) {
      STATE.statistics.dataQuality[sensor].outliers++;
      console.warn(`Outlier detected for ${sensor}:`, numValue);
    }
    
    // Check for data freshness
    const isFresh = this.isDataFresh();
    if (!isFresh) {
      console.warn('Data is not fresh');
    }
    
    STATE.statistics.dataQuality[sensor].valid++;
    
    return { 
      valid: true, 
      isOutlier: isOutlier,
      isFresh: isFresh,
      value: numValue 
    };
  },
  
  isOutlier(sensor, value) {
    const history = STATE.dataHistory[sensor];
    if (history.length < 10) return false;
    
    // Calculate mean and standard deviation
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / history.length;
    const stdDev = Math.sqrt(variance);
    
    // Value is outlier if beyond 3 standard deviations
    return Math.abs(value - mean) > (3 * stdDev);
  },
  
  isDataFresh() {
    if (!STATE.lastUpdate) return false;
    const age = new Date() - new Date(STATE.lastUpdate);
    return age < 60000; // Fresh if less than 1 minute old
  },
  
  getQualityReport() {
    const report = {};
    Object.keys(STATE.statistics.dataQuality).forEach(sensor => {
      const stats = STATE.statistics.dataQuality[sensor];
      const total = stats.valid + stats.invalid;
      report[sensor] = {
        ...stats,
        qualityPercentage: total > 0 ? ((stats.valid / total) * 100).toFixed(1) : 0
      };
    });
    return report;
  }
};

// ===================================
// Accessibility Features
// ===================================
const Accessibility = {
  init() {
    console.log('♿ Accessibility features initialized');
    this.setupKeyboardNavigation();
    this.addAriaLabels();
    this.setupFocusManagement();
  },
  
  setupKeyboardNavigation() {
    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Alt+1 to Alt+4: Focus on gauge cards
      if (e.altKey && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const gauges = document.querySelectorAll('.gauge-card');
        const index = parseInt(e.key) - 1;
        if (gauges[index]) {
          gauges[index].focus();
          gauges[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      
      // Alt+R: Refresh data
      if (e.altKey && e.key === 'r') {
        e.preventDefault();
        document.getElementById('refreshBtn')?.click();
      }
      
      // Alt+T: Toggle theme
      if (e.altKey && e.key === 't') {
        e.preventDefault();
        document.getElementById('themeToggle')?.click();
      }
      
      // Alt+H: Show help
      if (e.altKey && e.key === 'h') {
        e.preventDefault();
        this.showKeyboardShortcuts();
      }
    });
  },
  
  addAriaLabels() {
    // Add ARIA labels to gauges
    document.querySelectorAll('.gauge-card').forEach((card, index) => {
      const sensor = Object.keys(CONFIG.sensors)[index];
      const config = CONFIG.sensors[sensor];
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', `${config.name} gauge`);
      card.setAttribute('tabindex', '0');
    });
    
    // Add ARIA labels to charts
    document.querySelectorAll('.chart-card').forEach((card, index) => {
      const sensor = Object.keys(CONFIG.sensors)[index];
      const config = CONFIG.sensors[sensor];
      card.setAttribute('role', 'img');
      card.setAttribute('aria-label', `${config.name} trend chart`);
    });
    
    // Add ARIA labels to buttons
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.setAttribute('aria-label', 'Refresh dashboard data');
    }
    
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
      themeBtn.setAttribute('aria-label', 'Toggle dark mode');
    }
  },
  
  setupFocusManagement() {
    // Enhanced focus indicators
    document.querySelectorAll('button, a, input, [tabindex]').forEach(el => {
      el.addEventListener('focus', () => {
        el.classList.add('keyboard-focus');
      });
      el.addEventListener('blur', () => {
        el.classList.remove('keyboard-focus');
      });
    });
  },
  
  showKeyboardShortcuts() {
    const shortcuts = [
      { key: 'Alt+1-4', action: 'Focus on gauge cards' },
      { key: 'Alt+R', action: 'Refresh data' },
      { key: 'Alt+T', action: 'Toggle theme' },
      { key: 'Alt+H', action: 'Show this help' },
      { key: 'Ctrl+S', action: 'Export data to CSV' },
      { key: 'Ctrl+P', action: 'Print dashboard' }
    ];
    
    const message = shortcuts.map(s => `${s.key}: ${s.action}`).join('\n');
    alert('Keyboard Shortcuts:\n\n' + message);
  }
};

// ===================================
// Loading States & UI Feedback
// ===================================
const LoadingStates = {
  show(element) {
    if (typeof element === 'string') {
      element = document.getElementById(element);
    }
    if (element) {
      element.classList.add('loading');
      element.setAttribute('aria-busy', 'true');
    }
  },
  
  hide(element) {
    if (typeof element === 'string') {
      element = document.getElementById(element);
    }
    if (element) {
      element.classList.remove('loading');
      element.setAttribute('aria-busy', 'false');
    }
  },
  
  showSkeleton() {
    document.querySelectorAll('.gauge-value .value, .stat-value').forEach(el => {
      if (el.textContent === '--' || el.textContent === '') {
        el.classList.add('skeleton');
      }
    });
  },
  
  hideSkeleton() {
    document.querySelectorAll('.skeleton').forEach(el => {
      el.classList.remove('skeleton');
    });
  }
};

// ===================================
// User Preferences Manager
// ===================================
const UserPreferences = {
  defaults: {
    refreshInterval: 20000,
    chartRange: 60,
    enableNotifications: false,
    enableSounds: false,
    customThresholds: null
  },
  
  get(key) {
    return STATE.userPreferences[key] ?? this.defaults[key];
  },
  
  set(key, value) {
    STATE.userPreferences[key] = value;
    localStorage.setItem('userPreferences', JSON.stringify(STATE.userPreferences));
    console.log(`Preference updated: ${key} = ${value}`);
  },
  
  reset() {
    STATE.userPreferences = { ...this.defaults };
    localStorage.setItem('userPreferences', JSON.stringify(STATE.userPreferences));
    console.log('Preferences reset to defaults');
  }
};

// Initialize accessibility on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof Accessibility !== 'undefined') Accessibility.init();
  });
} else {
  setTimeout(() => {
    if (typeof Accessibility !== 'undefined') Accessibility.init();
  }, 1500);
}
