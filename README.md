# IoT Environmental Monitoring Dashboard

A production-grade, enterprise-level web dashboard for real-time environmental and water level monitoring using ThingSpeak IoT platform.

## 🎯 Features

### Core Functionality
- ✅ **Real-time Monitoring**: Live sensor data via MQTT + REST API every 5 minutes
- ✅ **Historical Analytics**: Interactive charts with 1h/6h/24h views
- ✅ **Multi-Sensor Support**: Temperature, Humidity, Pressure, Water Level
- ✅ **Smart Alerts**: Browser notifications for critical thresholds
- ✅ **Dark Mode**: Professional light/dark theme toggle
- ✅ **Data Export**: CSV/JSON export with keyboard shortcuts

### Advanced Features (Senior Engineer Implementations)
- 🔒 **Error Handling**: Retry logic with exponential backoff
- 📊 **Analytics**: Performance monitoring, data quality tracking
- ♿ **Accessibility**: ARIA labels, keyboard navigation (Alt+1-4, Alt+R, Alt+T, Alt+H)
- 🎨 **Loading States**: Skeleton loaders, loading indicators
- 📈 **Data Validation**: Outlier detection, freshness checks
- 💾 **User Preferences**: Customizable settings with localStorage
- 🔔 **Smart Notifications**: Threshold-based alerts
- ⚡ **Performance Tracking**: API latency, memory usage monitoring

## 🚀 Quick Start

### Prerequisites
- Modern web browser (Chrome, Firefox, Edge, Safari)
- Internet connection for ThingSpeak API
- ThingSpeak Channel with Read API Key

### Installation

1. **Clone or download** this repository
2. **Open** `index.html` in your web browser
3. **Configure** (if using different channel):
   ```javascript
   // In app.js, update CONFIG object:
   const CONFIG = {
     channelId: YOUR_CHANNEL_ID,
     apiKey: 'YOUR_API_KEY',
     // ...
   };
   ```

### No Build Required
This is a pure HTML/CSS/JavaScript application with no dependencies or build steps.

## 📁 Project Structure

```
iot-web-dashboard/
├── index.html                    # Main HTML structure
├── styles-professional.css       # Professional styling
├── app.js                        # Application logic
└── README.md                     # Documentation
```

## 🎮 Usage

### Keyboard Shortcuts
- `Alt+1-4` - Focus on gauge cards (Temperature, Humidity, Pressure, Water)
- `Alt+R` - Refresh data manually
- `Alt+T` - Toggle dark/light theme
- `Alt+H` - Show keyboard shortcuts help
- `Ctrl+S` (Cmd+S) - Export data to CSV
- `Ctrl+P` (Cmd+P) - Print dashboard

### Navigation
- **Stats Overview**: Quick metrics (active sensors, data points, API status)
- **Live Gauges**: Real-time circular gauges with color-coded status
- **Historical Charts**: Interactive line charts with time range controls
- **System Info**: Health indicators, activity log, configuration

### Time Range Controls
- **1 Hour**: Last 60 data points
- **6 Hours**: Last 360 data points
- **24 Hours**: Last 1440 data points

## 🔧 Configuration

### Data Source & Protocol
```javascript
// MQTT over WebSocket (Real-time, Primary)
mqtt: {
  enabled: true,
  broker: 'mqtt3.thingspeak.com',
  port: 8883,
  protocol: 'wss' // WebSocket Secure
}

// REST API (Fallback/Historical)
channelId: 3216999,
apiKey: 'G6OOCBLAPWKE8V2D'
```

### Sensor Thresholds
Edit in `app.js`:
```javascript
sensors: {
  temperature: { min: 15, max: 35 },
  humidity: { min: 30, max: 80 },
  pressure: { min: 980, max: 1040 },
  waterLevel: { min: 0, max: 100 }
}
```

### Update Intervals
```javascript
updateInterval: 300000,      // Live data refresh (5 minutes) - matches Pico backend
chartUpdateInterval: 300000  // Chart data refresh (5 minutes)
staleThresholdMs: 360000     // Mark stale if no data for 6 minutes
```

### Retry Configuration
```javascript
maxRetries: 3,              // Number of retry attempts
retryDelay: 2000,           // Initial retry delay (ms)
requestTimeout: 10000       // Request timeout (ms)
```

## 📊 Data Export

### CSV Export
1. Press `Ctrl+S` or click Export button (if added)
2. File includes: Timestamp, Temperature, Humidity, Pressure, Water Level
3. Format: `iot-data-YYYY-MM-DD.csv`

### JSON Export
Programmatic export available via:
```javascript
DataExport.exportToJSON();
```

## 🔔 Notifications

### Browser Notifications
1. Grant permission when prompted
2. Automatic alerts for:
   - Values below minimum threshold
   - Values above maximum threshold
   - Connection errors

### Alert Thresholds
- **Critical**: Value outside min/max range
- **Warning**: Value near threshold (10% margin)
- **Normal**: Value within safe range

## 🎨 Themes

### Light Theme (Default)
- Professional gray/navy palette
- High readability
- Suitable for office environments

### Dark Theme
- Reduces eye strain
- Better for low-light conditions
- Toggle with `Alt+T` or theme button

## 📈 Analytics & Monitoring

### Performance Metrics
- API response time (average)
- Success/failure rate
- Memory usage (if available)
- Data quality statistics

### Data Quality Tracking
- Valid/invalid data count
- Outlier detection (3σ method)
- Data freshness validation

### View Statistics
Open browser console and check logs for:
```
⚡ Performance: { apiLatency, memory, totalRequests, successRate }
📊 Statistics: { uptime, avgResponseTime }
```

## ♿ Accessibility

### WCAG 2.1 Compliance
- ✅ Keyboard navigation
- ✅ ARIA labels and roles
- ✅ Focus management
- ✅ Screen reader support
- ✅ High contrast mode
- ✅ Reduced motion support

### Screen Reader Support
All interactive elements have descriptive ARIA labels:
- Gauges: "Temperature gauge", "Humidity gauge", etc.
- Charts: "Temperature trend chart", etc.
- Buttons: Descriptive action labels

## 🐛 Error Handling

### Automatic Recovery
- **Retry Logic**: 3 attempts with exponential backoff
- **Timeout Protection**: 10-second request timeout
- **Connection Status**: Real-time connection indicator
- **User Feedback**: Error toasts with clear messages

### Troubleshooting

**Dashboard not loading?**
- Check browser console for errors
- Verify API key is correct (letter O not zero)
- Check internet connection
- Clear browser cache

**No data displaying?**
- Check ThingSpeak channel is public or API key is correct
- Verify channel has recent data
- Check browser console for API errors

**Charts not rendering?**
- Ensure Chart.js and Luxon libraries loaded
- Check browser console for errors
- Try refreshing the page

## 🔒 Security Considerations

### Current Implementation
⚠️ **API key exposed in frontend code** - Acceptable for public channels

### Production Recommendations
1. **Use Backend Proxy**: Route API calls through server
2. **Environment Variables**: Store API keys securely
3. **Rate Limiting**: Implement request throttling
4. **HTTPS Only**: Enforce secure connections
5. **Input Validation**: Sanitize all user inputs

## 🧪 Testing

### Manual Testing Checklist
- [ ] All gauges display correctly
- [ ] Charts render and update
- [ ] Theme toggle works
- [ ] Keyboard shortcuts functional
- [ ] Data export works
- [ ] Notifications appear
- [ ] Error handling triggers correctly
- [ ] Responsive design on mobile
- [ ] Accessibility features work

### Browser Compatibility
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## 📱 Responsive Design

### Breakpoints
- **Desktop**: > 1024px (full layout)
- **Tablet**: 768px - 1024px (2-column layout)
- **Mobile**: < 768px (single column)

## 🚀 Performance Optimization

### Implemented
- Debounced resize handlers
- Efficient chart updates (`chart.update('none')`)
- LocalStorage for preferences
- Minimal DOM manipulation
- CSS animations over JavaScript

### Recommendations
- Add Service Worker for offline support
- Implement lazy loading for charts
- Use Web Workers for heavy computations
- Add resource hints (prefetch, preconnect)

## 📝 License

Academic Project - Faculty of Science and Marine Environment (FSKM)
Universiti Malaysia Terengganu - CSM3313 IoT Computing

## 👥 Credits

**Course**: CSM3313 IoT Computing  
**Institution**: Universiti Malaysia Terengganu (UMT)  
**Faculty**: FSKM  
**Year**: 2026

**Technologies**:
- Chart.js v4.4.1
- Luxon v3.4.1
- ThingSpeak IoT Platform
- Modern Web Standards (ES6+, CSS Grid, Flexbox)

## 🔄 Version History

### v2.0.0 - Senior Engineer Enhancements (Current)
- ✅ Advanced error handling with retry logic
- ✅ Accessibility features (WCAG 2.1)
- ✅ Data validation and quality tracking
- ✅ Loading states and skeletons
- ✅ User preferences management
- ✅ Performance monitoring
- ✅ Enhanced keyboard navigation

### v1.0.0 - Initial Professional Release
- ✅ Core dashboard functionality
- ✅ Real-time gauges and charts
- ✅ Dark mode theme
- ✅ Activity logging
- ✅ Basic analytics

## 📞 Support

For issues or questions:
1. Check browser console for errors
2. Review this README
3. Verify API configuration
4. Test with different browsers

## 🎯 Future Enhancements

### Planned Features
- [ ] Backend API proxy for security
- [ ] User authentication
- [ ] Multi-dashboard support
- [ ] Email/SMS alerts
- [ ] Advanced ML predictions
- [ ] Historical data comparison
- [ ] Custom dashboard layouts
- [ ] Mobile app version
- [ ] Docker deployment
- [ ] CI/CD pipeline

---

**Built with 💙 for IoT Computing Excellence**
