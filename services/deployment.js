const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const pm2 = require('pm2');
const App = require('../models/App');
const Deployment = require('../models/Deployment');
const socketService = require('./socket');
const logManager = require('./logManager');

class DeploymentService {
  constructor() {
    this.deploymentDir = path.join(__dirname, '..', 'deployments');
    this.portRange = {
      start: parseInt(process.env.PM2_PORT_START) || 4000,
      end: parseInt(process.env.PM2_PORT_END) || 5000
    };
    this.usedPorts = new Set();
    this.initializeDeploymentDir();
    this.initializePM2();
  }

  async initializeDeploymentDir() {
    try {
      await fs.mkdir(this.deploymentDir, { recursive: true });
      await fs.mkdir(path.join(this.deploymentDir, 'logs'), { recursive: true });
      console.log('Deployment directories initialized');
    } catch (error) {
      console.error('Error creating deployment directory:', error);
    }
  }

  async initializePM2() {
    return new Promise((resolve, reject) => {
      pm2.connect((err) => {
        if (err) {
          console.error('PM2 connection error:', err);
          // Don't reject - PM2 might not be running yet
          console.log('PM2 not connected, will try to connect on first deployment');
          resolve();
        } else {
          console.log('Connected to PM2');
          
          // Try to resurrect processes from dump file
          this.resurrectPM2Processes();
          
          resolve();
        }
      });
    });
  }

  // Resurrect PM2 processes from dump file
  async resurrectPM2Processes() {
    return new Promise((resolve) => {
      pm2.resurrect((err) => {
        if (err) {
          console.log('No PM2 dump file found or error resurrecting processes:', err.message);
        } else {
          console.log('PM2 processes resurrected from dump file');
          
          // Update app statuses in database based on actual PM2 status
          this.syncAppStatusesWithPM2();
        }
        resolve();
      });
    });
  }

  // Sync app statuses with actual PM2 process statuses
  async syncAppStatusesWithPM2() {
    try {
      const apps = await App.find({ 'deployment.pm2Id': { $ne: null } });
      
      for (const app of apps) {
        pm2.describe(app.deployment.pm2Id, async (err, processDescription) => {
          if (err || !processDescription || processDescription.length === 0) {
            // Process not found in PM2, mark as stopped
            app.deployment.status = 'stopped';
            await app.save();
            console.log(`App ${app.name} marked as stopped (not found in PM2)`);
          } else {
            const process = processDescription[0];
            const pm2Status = process.pm2_env.status;
            
            let appStatus = 'stopped';
            if (pm2Status === 'online') {
              appStatus = 'running';
            } else if (pm2Status === 'errored') {
              appStatus = 'failed';
            }
            
            if (app.deployment.status !== appStatus) {
              app.deployment.status = appStatus;
              await app.save();
              console.log(`App ${app.name} status synced: ${appStatus}`);
            }
          }
        });
      }
    } catch (error) {
      console.error('Error syncing app statuses with PM2:', error);
    }
  }

  // Get available port
  async getAvailablePort() {
    const usedPorts = await this.getUsedPorts();
    
    for (let port = this.portRange.start; port <= this.portRange.end; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }
    
    throw new Error('No available ports in the specified range');
  }

  // Get currently used ports
  async getUsedPorts() {
    const apps = await App.find({ 'deployment.status': 'running' });
    const usedPorts = new Set();
    
    apps.forEach(app => {
      if (app.configuration.port) {
        usedPorts.add(app.configuration.port);
      }
    });
    
    return usedPorts;
  }

  // Deploy application
  async deployApp(appId, userId, accessToken) {
    let deployment = null;
    
    try {
      console.log(`Starting deployment for app ${appId} by user ${userId}`);
      
      const app = await App.findById(appId);
      if (!app) {
        throw new Error('App not found');
      }

      console.log(`Found app: ${app.name}, repository: ${app.repository.fullName}`);

      // Create deployment record
      deployment = new Deployment({
        appId,
        userId,
        status: 'in_progress',
        startedAt: new Date()
      });
      await deployment.save();

      console.log(`Created deployment record: ${deployment._id}`);

      // Update app status
      app.deployment.status = 'building';
      await app.save();

      // Update latest commit information before deployment
      await this.updateLatestCommit(app, userId, accessToken);
      
      // Emit deployment started
      socketService.emitDeploymentStatus(appId, 'building');
      await this.addDeploymentLog(deployment, 'info', 'Deployment started');
      
      // Clone repository with access token
      await this.cloneRepository(app, deployment, accessToken);
      
      // Install dependencies
      await this.installDependencies(app, deployment);
      
      // Start application with PM2
      await this.startWithPM2(app, deployment);
      
      // Update deployment status
      deployment.status = 'success';
      deployment.completedAt = new Date();
      await deployment.save();

      // Update app status
      app.deployment.status = 'running';
      app.deployment.deployedAt = new Date();
      app.deployment.lastDeployment = new Date();
      app.deployment.deploymentCount += 1;
      
      // Generate app URL - prioritize subdomain if available
      if (app.subdomain && process.env.BASE_DOMAIN) {
        const subdomainService = require('./subdomain');
        app.url = subdomainService.generateSubdomainUrl(app.subdomain);
      } else {
        // Fallback to port-based URL
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        const baseUrl = process.env.APPS_BASE_URL || process.env.BASE_URL?.replace(':3000', '') || `${protocol}://localhost`;
        app.url = `${baseUrl}:${app.configuration.port}`;
      }
      
      await app.save();

      socketService.emitDeploymentStatus(appId, 'success');
      await this.addDeploymentLog(deployment, 'info', 'Deployment completed successfully');
      
      console.log(`Deployment completed successfully for app ${appId}`);
      return { success: true, deployment };
      
    } catch (error) {
      console.error('Deployment error:', error);
      
      if (deployment) {
        deployment.status = 'failed';
        deployment.error = error.message;
        deployment.completedAt = new Date();
        await deployment.save();
        await this.addDeploymentLog(deployment, 'error', `Deployment failed: ${error.message}`);
      }

      const app = await App.findById(appId);
      if (app) {
        // Clean up any PM2 process that might have been started
        if (app.deployment.pm2Id) {
          try {
            await this.addDeploymentLog(deployment, 'info', 'Cleaning up PM2 process due to deployment failure');
            await new Promise((resolve) => {
              pm2.delete(app.deployment.pm2Id, (deleteErr) => {
                if (deleteErr) {
                  console.error('Error deleting PM2 process:', deleteErr);
                }
                resolve();
              });
            });
            await this.addDeploymentLog(deployment, 'info', 'PM2 process cleaned up');
          } catch (cleanupError) {
            console.error('Error cleaning up PM2 process:', cleanupError);
            await this.addDeploymentLog(deployment, 'warn', `Warning: Could not clean up PM2 process: ${cleanupError.message}`);
          }
        }
        
        // Set app status to failed
        app.deployment.status = 'failed';
        app.deployment.lastError = error.message;
        app.deployment.lastErrorAt = new Date();
        await app.save();
      }

      socketService.emitDeploymentStatus(appId, 'failed');
      socketService.emitAppStatus(appId, 'failed');
      
      throw error;
    }
  }

  // Clone repository
  async cloneRepository(app, deployment, accessToken) {
    return new Promise(async (resolve, reject) => {
      const appDir = path.join(this.deploymentDir, app._id.toString());
      
      // Create authenticated clone URL
      let cloneUrl = app.repository.cloneUrl;
      if (accessToken && cloneUrl.includes('github.com')) {
        // Convert HTTPS URL to authenticated URL
        cloneUrl = cloneUrl.replace('https://github.com/', `https://${accessToken}@github.com/`);
      }
      
      // Clean up existing directory if it exists
      try {
        if (await this.directoryExists(appDir)) {
          await this.addDeploymentLog(deployment, 'info', `Cleaning up existing deployment directory`);
          await fs.rm(appDir, { recursive: true, force: true });
        }
      } catch (error) {
        await this.addDeploymentLog(deployment, 'warn', `Warning: Could not clean directory: ${error.message}`);
      }
      
      await this.addDeploymentLog(deployment, 'info', `Cloning repository: ${app.repository.fullName}`);
      
      // Use authenticated URL but don't log it for security
      const gitClone = spawn('git', ['clone', cloneUrl, appDir]);
      
      // Set timeout for git clone (5 minutes)
      const timeout = setTimeout(() => {
        gitClone.kill('SIGTERM');
        reject(new Error('Git clone timed out after 5 minutes'));
      }, 5 * 60 * 1000);
      
      gitClone.stdout.on('data', async (data) => {
        const message = data.toString().trim();
        if (message) {
          await this.addDeploymentLog(deployment, 'info', message);
        }
      });
      
      gitClone.stderr.on('data', async (data) => {
        const message = data.toString().trim();
        if (message) {
          await this.addDeploymentLog(deployment, 'warn', message);
        }
      });
      
      gitClone.on('close', async (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          await this.addDeploymentLog(deployment, 'info', 'Repository cloned successfully');
          resolve();
        } else {
          reject(new Error(`Git clone failed with code ${code}`));
        }
      });
      
      gitClone.on('error', async (error) => {
        clearTimeout(timeout);
        await this.addDeploymentLog(deployment, 'error', `Git clone error: ${error.message}`);
        reject(error);
      });
    });
  }

  // Install dependencies
  async installDependencies(app, deployment) {
    return new Promise(async (resolve, reject) => {
      const appDir = path.join(this.deploymentDir, app._id.toString());
      const buildCommand = app.configuration.buildCommand || 'npm install';
      
      await this.addDeploymentLog(deployment, 'info', `Installing dependencies: ${buildCommand}`);
      
      const install = spawn('sh', ['-c', buildCommand], { cwd: appDir });
      
      install.stdout.on('data', async (data) => {
        const message = data.toString().trim();
        if (message) {
          await this.addDeploymentLog(deployment, 'info', message);
        }
      });
      
      install.stderr.on('data', async (data) => {
        const message = data.toString().trim();
        if (message) {
          await this.addDeploymentLog(deployment, 'warn', message);
        }
      });
      
      install.on('close', async (code) => {
        if (code === 0) {
          await this.addDeploymentLog(deployment, 'info', 'Dependencies installed successfully');
          resolve();
        } else {
          reject(new Error(`Dependency installation failed with code ${code}`));
        }
      });
    });
  }

  // Start application with PM2
  async startWithPM2(app, deployment) {
    return new Promise(async (resolve, reject) => {
      const appDir = path.join(this.deploymentDir, app._id.toString());
      const pm2Id = `app_${app._id}`;
      
      // Ensure log directory exists
      const logDir = path.join(this.deploymentDir, 'logs');
      try {
        await fs.mkdir(logDir, { recursive: true });
      } catch (error) {
        console.error('Error creating log directory:', error);
      }
      
      const pm2Config = {
        name: pm2Id,
        script: app.configuration.startupCommand.split(' ')[0],
        args: app.configuration.startupCommand.split(' ').slice(1).join(' '),
        cwd: appDir,
        env: {
          PORT: app.configuration.port,
          NODE_ENV: 'production',
          ...Object.fromEntries(app.configuration.environmentVariables)
        },
        log_file: path.join(logDir, `${pm2Id}.log`),
        out_file: path.join(logDir, `${pm2Id}.out`),
        error_file: path.join(logDir, `${pm2Id}.err`),
        max_memory_restart: '500M',
        instances: 1,
        exec_mode: 'fork',
        // Add timestamp formatting to PM2 logs
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        merge_logs: true,
        time: true,
        // Ensure PM2 doesn't try to use null paths
        disable_logs: false,
        combine_logs: true
      };

      await this.addDeploymentLog(deployment, 'info', `Starting application with PM2: ${pm2Id}`);
      
      // Ensure PM2 is connected before starting
      pm2.connect(async (connectErr) => {
        if (connectErr) {
          await this.addDeploymentLog(deployment, 'error', `PM2 connection failed: ${connectErr.message}`);
          reject(connectErr);
          return;
        }
        
        // First, try to delete any existing process with the same name
        pm2.delete(pm2Id, async (deleteErr) => {
          // Ignore delete errors - process might not exist
          
          pm2.start(pm2Config, async (err, proc) => {
            if (err) {
              await this.addDeploymentLog(deployment, 'error', `PM2 start failed: ${err.message}`);
              console.error('PM2 start error details:', err);
              reject(err);
            } else {
              app.deployment.pm2Id = pm2Id;
              await this.addDeploymentLog(deployment, 'info', `Application started successfully on port ${app.configuration.port}`);
              
              // Wait a moment and check if the process is actually running
              setTimeout(async () => {
                pm2.describe(pm2Id, async (describeErr, processDescription) => {
                  if (describeErr || !processDescription || processDescription.length === 0) {
                    await this.addDeploymentLog(deployment, 'error', 'Process failed to start properly');
                    reject(new Error('Process failed to start properly'));
                  } else {
                    const process = processDescription[0];
                    const status = process.pm2_env.status;
                    
                    if (status === 'errored' || status === 'stopped') {
                      await this.addDeploymentLog(deployment, 'error', `Process status: ${status}`);
                      reject(new Error(`Process is in ${status} state`));
                                         } else {
                       await this.addDeploymentLog(deployment, 'info', `Process is running with status: ${status}`);
                       
                       // Save PM2 process list for persistence
                       pm2.dump((dumpErr) => {
                         if (dumpErr) {
                           console.error('Error saving PM2 dump:', dumpErr);
                         } else {
                           console.log('PM2 process list saved for persistence');
                         }
                       });
                       
                       resolve();
                     }
                  }
                });
              }, 2000);
            }
          });
        });
      });
    });
  }

  // Stop application
  async stopApp(appId) {
    try {
      const app = await App.findById(appId);
      if (!app || !app.deployment.pm2Id) {
        throw new Error('App not found or not running');
      }

      await this.stopAppProcess(app);
      
      // Update app status
      app.deployment.status = 'stopped';
      await app.save();
      
      // Save PM2 process list for persistence
      pm2.dump((dumpErr) => {
        if (dumpErr) {
          console.error('Error saving PM2 dump:', dumpErr);
        } else {
          console.log('PM2 process list saved for persistence');
        }
      });
      
      socketService.emitAppStatus(appId, 'stopped');
      
      return { success: true };
    } catch (error) {
      console.error('Error stopping app:', error);
      throw error;
    }
  }

  // Internal method to stop app process via PM2
  async stopAppProcess(app) {
    return new Promise((resolve, reject) => {
      pm2.stop(app.deployment.pm2Id, (err) => {
        if (err) {
          console.error('PM2 stop error:', err);
          reject(err);
        } else {
          console.log(`App ${app.name} stopped successfully`);
          resolve();
        }
      });
    });
  }

  // Restart application
  async restartApp(appId) {
    try {
      const app = await App.findById(appId);
      if (!app || !app.deployment.pm2Id) {
        throw new Error('App not found or not running');
      }

      return new Promise((resolve, reject) => {
        pm2.restart(app.deployment.pm2Id, (err) => {
          if (err) {
            reject(err);
          } else {
            app.deployment.status = 'running';
            app.save();
            
            // Save PM2 process list for persistence
            pm2.dump((dumpErr) => {
              if (dumpErr) {
                console.error('Error saving PM2 dump:', dumpErr);
              } else {
                console.log('PM2 process list saved for persistence');
              }
            });
            
            socketService.emitAppStatus(appId, 'running');
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Error restarting app:', error);
      throw error;
    }
  }

  // Delete application
  async deleteApp(appId) {
    try {
      const app = await App.findById(appId);
      if (!app) {
        throw new Error('App not found');
      }

      console.log(`Starting deletion process for app: ${app.name} (ID: ${appId})`);

      // Release subdomain if it exists
      if (app.subdomain) {
        try {
          const subdomainService = require('./subdomain');
          await subdomainService.releaseSubdomain(app.subdomain);
          console.log(`Subdomain ${app.subdomain} released for app ${app.name}`);
        } catch (subdomainError) {
          console.error('Error releasing subdomain:', subdomainError);
          // Continue with deletion even if subdomain release fails
        }
      }

      // Stop PM2 process if running
      if (app.deployment.pm2Id) {
        await new Promise((resolve, reject) => {
          pm2.delete(app.deployment.pm2Id, (err) => {
            if (err) {
              console.error('Error deleting PM2 process:', err);
            } else {
              console.log(`PM2 process ${app.deployment.pm2Id} deleted for app ${app.name}`);
            }
            resolve();
          });
        });
      }

      // Remove deployment directory
      const appDir = path.join(this.deploymentDir, app._id.toString());
      try {
        await fs.rm(appDir, { recursive: true, force: true });
        console.log(`Deployment directory removed for app ${app.name}`);
      } catch (error) {
        console.error('Error removing deployment directory:', error);
      }

      // Remove from database - this will automatically release the subdomain 
      // due to the unique constraint and sparse index
      await App.findByIdAndDelete(appId);
      await Deployment.deleteMany({ appId });
      
      console.log(`App ${app.name} and related deployments removed from database`);

      // Save PM2 process list for persistence
      pm2.dump((dumpErr) => {
        if (dumpErr) {
          console.error('Error saving PM2 dump:', dumpErr);
        } else {
          console.log('PM2 process list saved for persistence');
        }
      });

      console.log(`App deletion completed successfully for: ${app.name}`);
      return { success: true };
    } catch (error) {
      console.error('Error deleting app:', error);
      throw error;
    }
  }

  // Add deployment log
  async addDeploymentLog(deployment, level, message) {
    try {
      // Use findByIdAndUpdate to avoid parallel save issues
      await Deployment.findByIdAndUpdate(
        deployment._id,
        {
          $push: {
            logs: {
              timestamp: new Date(),
              level,
              message
            }
          }
        }
      );
      
      // Emit log to connected clients
      socketService.emitDeploymentLog(deployment.appId, {
        level,
        message,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error adding deployment log:', error);
    }
  }

  // Get app logs with pagination
  async getAppLogs(appId, options = {}) {
    const { page = 1, pageSize = 50, lines = 100 } = options;
    
    try {
      const app = await App.findById(appId);
      if (!app) {
        return { 
          logs: [], 
          status: 'not_found',
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

      // If app doesn't have PM2 ID, check for deployment logs
      if (!app.deployment.pm2Id) {
        // Try to get deployment logs for failed deployments
        const recentDeployments = await Deployment.find({ appId })
          .sort({ createdAt: -1 })
          .limit(5);
        
        if (recentDeployments.length > 0) {
          const deploymentLogs = [];
          recentDeployments.forEach(deployment => {
            if (deployment.logs && deployment.logs.length > 0) {
              deployment.logs.forEach(log => {
                deploymentLogs.push({
                  timestamp: log.timestamp,
                  message: log.message,
                  level: log.level,
                  type: 'deployment'
                });
              });
            }
          });
          
          deploymentLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          
          return {
            logs: deploymentLogs.slice(0, lines),
            status: app.deployment.status || 'not_running',
            pagination: {
              page: 1,
              pageSize: lines,
              totalLines: deploymentLogs.length,
              totalPages: 1,
              hasNext: false,
              hasPrev: false
            }
          };
        }
        
        return { 
          logs: [], 
          status: app.deployment.status || 'not_running',
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

      return new Promise((resolve, reject) => {
        // First check if the process is running
        pm2.describe(app.deployment.pm2Id, async (err, processDescription) => {
          if (err) {
            reject(err);
            return;
          }

          if (!processDescription || processDescription.length === 0) {
            resolve({ 
              logs: [], 
              status: 'not_found',
              pagination: {
                page: 1,
                pageSize,
                totalLines: 0,
                totalPages: 0,
                hasNext: false,
                hasPrev: false
              }
            });
            return;
          }

          const process = processDescription[0];
          const status = process.pm2_env.status;

          try {
            // Read log files directly with pagination
            const logFiles = {
              stdout: process.pm2_env.pm_out_log_path,
              stderr: process.pm2_env.pm_err_log_path
            };

            // Clean up old logs first
            await logManager.cleanupOldLogs();

            let result;
            if (page && pageSize) {
              // Use pagination
              result = await logManager.getCombinedPaginatedLogs(logFiles, page, pageSize);
            } else {
              // Fallback to old behavior for backward compatibility
              const logs = [];

              // Read output logs
              if (logFiles.stdout && await this.fileExists(logFiles.stdout)) {
                const outLogs = await this.readLogFile(logFiles.stdout, lines);
                logs.push(...outLogs.map(log => ({ ...log, type: 'stdout' })));
              }

              // Read error logs
              if (logFiles.stderr && await this.fileExists(logFiles.stderr)) {
                const errorLogs = await this.readLogFile(logFiles.stderr, lines);
                logs.push(...errorLogs.map(log => ({ ...log, type: 'stderr' })));
              }

              // Sort logs by timestamp
              logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

              result = {
                logs: logs.slice(-lines),
                pagination: {
                  page: 1,
                  pageSize: lines,
                  totalLines: logs.length,
                  totalPages: 1,
                  hasNext: false,
                  hasPrev: false
                }
              };
            }

            resolve({
              ...result,
              status,
              processInfo: {
                pid: process.pid,
                uptime: process.pm2_env.pm_uptime,
                restarts: process.pm2_env.restart_time,
                memory: process.monit ? process.monit.memory : 0,
                cpu: process.monit ? process.monit.cpu : 0
              }
            });
          } catch (logError) {
            console.error('Error reading log files:', logError);
            resolve({
              logs: [],
              status,
              error: 'Could not read log files',
              pagination: {
                page: 1,
                pageSize,
                totalLines: 0,
                totalPages: 0,
                hasNext: false,
                hasPrev: false
              }
            });
          }
        });
      });
    } catch (error) {
      console.error('Error getting app logs:', error);
      throw error;
    }
  }

  // Helper method to check if file exists
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Helper method to check if directory exists
  async directoryExists(dirPath) {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  // Helper method to read log file
  async readLogFile(filePath, maxLines = 100) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      return lines.slice(-maxLines).map((line, index) => {
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
                // If no timestamp found, use current time and keep full message
                timestamp = new Date();
                cleanMessage = line;
              }
            }
          }
        }
        
        return {
          timestamp: timestamp.toISOString(),
          message: cleanMessage,
          level: this.detectLogLevel(line),
          formattedTime: this.formatTimestamp(timestamp)
        };
      });
    } catch (error) {
      console.error('Error reading log file:', filePath, error);
      return [];
    }
  }

  // Helper method to format timestamp for display
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

  // Helper method to detect log level from message
  detectLogLevel(message) {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('error') || lowerMessage.includes('err')) return 'error';
    if (lowerMessage.includes('warn') || lowerMessage.includes('warning')) return 'warn';
    if (lowerMessage.includes('debug')) return 'debug';
    return 'info';
  }

  // Update latest commit information
  async updateLatestCommit(app, userId, accessToken) {
    try {
      const githubService = require('./github');
      
      if (!accessToken) {
        console.error('No access token provided');
        return;
      }

      const latestCommit = await githubService.getLatestCommit(
        accessToken,
        app.repository.owner,
        app.repository.name,
        app.repository.branch
      );

      if (latestCommit) {
        app.repository.lastCommit = {
          sha: latestCommit.sha,
          message: latestCommit.message,
          author: latestCommit.author.name,
          date: new Date(latestCommit.author.date),
          url: latestCommit.url
        };
        
        await app.save();
        console.log(`Updated commit info for app ${app.name}: ${latestCommit.sha.substring(0, 7)} - ${latestCommit.message}`);
      }
    } catch (error) {
      console.error('Error updating latest commit:', error);
      // Don't fail deployment if commit update fails
    }
  }
}

module.exports = new DeploymentService(); 