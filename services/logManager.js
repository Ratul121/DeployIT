const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

class LogManager {
  constructor() {
    this.logRetentionDays = 3;
    this.initializeCleanupSchedule();
  }

  // Initialize automatic log cleanup schedule
  initializeCleanupSchedule() {
    // Run cleanup every day at 2 AM
    cron.schedule('0 2 * * *', async () => {
      console.log('Starting daily log cleanup...');
      await this.cleanupOldLogs();
    });
    
    console.log('Log cleanup scheduler initialized - runs daily at 2 AM');
  }

  // Clean up logs older than retention period
  async cleanupOldLogs() {
    try {
      const deploymentDir = path.join(process.cwd(), 'deployments');
      const logsDir = path.join(deploymentDir, 'logs');
      
      if (!(await this.directoryExists(logsDir))) {
        return;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.logRetentionDays);
      
      const files = await fs.readdir(logsDir);
      let cleanedCount = 0;
      
      for (const file of files) {
        const filePath = path.join(logsDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          cleanedCount++;
          console.log(`Cleaned up old log file: ${file}`);
        }
      }
      
      console.log(`Log cleanup completed. Removed ${cleanedCount} old log files.`);
    } catch (error) {
      console.error('Error during log cleanup:', error);
    }
  }

  // Get paginated logs from log file
  async getPaginatedLogs(filePath, page = 1, pageSize = 50) {
    try {
      if (!(await this.fileExists(filePath))) {
        return {
          logs: [],
          pagination: {
            page: 1,
            pageSize,
            totalLines: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false
          }
        };
      }

      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Reverse lines to get newest first for pagination
      const reversedLines = lines.reverse();
      const totalLines = reversedLines.length;
      const totalPages = Math.ceil(totalLines / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      
      // Get logs for current page and reverse them to show chronological order within the page
      const pageLines = reversedLines.slice(startIndex, endIndex).reverse();
      
      const logs = pageLines.map((line, index) => {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
        const timestamp = timestampMatch ? new Date(timestampMatch[1]) : new Date();
        
        return {
          id: startIndex + index,
          timestamp: timestamp.toISOString(),
          message: line,
          level: this.detectLogLevel(line)
        };
      });

      return {
        logs,
        pagination: {
          page,
          pageSize,
          totalLines,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      console.error('Error reading paginated logs:', error);
      return {
        logs: [],
        pagination: {
          page: 1,
          pageSize,
          totalLines: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
        }
      };
    }
  }

  // Get combined paginated logs from multiple files
  async getCombinedPaginatedLogs(logFiles, page = 1, pageSize = 50) {
    try {
      const allLogs = [];
      
      // Read all log files
      for (const [type, filePath] of Object.entries(logFiles)) {
        if (await this.fileExists(filePath)) {
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          
          const logs = lines.map((line, index) => {
            // Enhanced timestamp extraction patterns
            let timestamp = new Date();
            let cleanMessage = line;
            
            // PM2 timestamp format: YYYY-MM-DD HH:mm:ss Z
            const pm2TimestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}): (.+)$/);
            if (pm2TimestampMatch) {
              timestamp = new Date(pm2TimestampMatch[1]);
              cleanMessage = pm2TimestampMatch[2];
            } else {
              // ISO timestamp format: YYYY-MM-DDTHH:mm:ss
              const isoTimestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?):?\s*(.*)$/);
              if (isoTimestampMatch) {
                timestamp = new Date(isoTimestampMatch[1]);
                cleanMessage = isoTimestampMatch[2] || line;
              } else {
                // Simple date format: MM/DD/YYYY HH:mm:ss
                const simpleDateMatch = line.match(/^(\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2}(?:\s*[AP]M)?):?\s*(.*)$/i);
                if (simpleDateMatch) {
                  timestamp = new Date(simpleDateMatch[1]);
                  cleanMessage = simpleDateMatch[2] || line;
                } else {
                  // Unix timestamp at start of line
                  const unixTimestampMatch = line.match(/^(\d{13}):?\s*(.*)$/);
                  if (unixTimestampMatch) {
                    timestamp = new Date(parseInt(unixTimestampMatch[1]));
                    cleanMessage = unixTimestampMatch[2] || line;
                  } else {
                    // If no timestamp found, use file modification time + line offset
                    timestamp = new Date(Date.now() + index * 1000);
                    cleanMessage = line;
                  }
                }
              }
            }
            
            return {
              timestamp: timestamp.getTime(),
              timestampISO: timestamp.toISOString(),
              message: cleanMessage,
              level: this.detectLogLevel(line),
              type: type,
              formattedTime: this.formatTimestamp(timestamp)
            };
          });
          
          allLogs.push(...logs);
        }
      }
      
      // Sort by timestamp (newest first for pagination)
      allLogs.sort((a, b) => b.timestamp - a.timestamp);
      
      // Apply pagination
      const totalLines = allLogs.length;
      const totalPages = Math.ceil(totalLines / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      
      // Get the paginated logs and reverse them to show chronological order within the page
      const paginatedLogs = allLogs.slice(startIndex, endIndex).reverse().map((log, index) => ({
        id: startIndex + index,
        timestamp: log.timestampISO,
        message: log.message,
        level: log.level,
        type: log.type
      }));

      return {
        logs: paginatedLogs,
        pagination: {
          page,
          pageSize,
          totalLines,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      console.error('Error reading combined paginated logs:', error);
      return {
        logs: [],
        pagination: {
          page: 1,
          pageSize,
          totalLines: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
        }
      };
    }
  }

  // Rotate log file if it gets too large
  async rotateLogFile(filePath, maxSize = 10 * 1024 * 1024) { // 10MB default
    try {
      if (!(await this.fileExists(filePath))) {
        return;
      }

      const stats = await fs.stat(filePath);
      if (stats.size > maxSize) {
        const rotatedPath = `${filePath}.${Date.now()}`;
        await fs.rename(filePath, rotatedPath);
        console.log(`Log file rotated: ${filePath} -> ${rotatedPath}`);
      }
    } catch (error) {
      console.error('Error rotating log file:', error);
    }
  }

  // Get log file statistics
  async getLogStats(filePath) {
    try {
      if (!(await this.fileExists(filePath))) {
        return {
          exists: false,
          size: 0,
          lines: 0,
          lastModified: null
        };
      }

      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim()).length;

      return {
        exists: true,
        size: stats.size,
        lines,
        lastModified: stats.mtime,
        sizeFormatted: this.formatBytes(stats.size)
      };
    } catch (error) {
      console.error('Error getting log stats:', error);
      return {
        exists: false,
        size: 0,
        lines: 0,
        lastModified: null
      };
    }
  }

  // Helper methods
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async directoryExists(dirPath) {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  detectLogLevel(message) {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('error') || lowerMessage.includes('err')) return 'error';
    if (lowerMessage.includes('warn') || lowerMessage.includes('warning')) return 'warn';
    if (lowerMessage.includes('debug')) return 'debug';
    return 'info';
  }

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  // Manual cleanup trigger
  async triggerCleanup() {
    console.log('Manual log cleanup triggered');
    await this.cleanupOldLogs();
  }
}

module.exports = new LogManager(); 