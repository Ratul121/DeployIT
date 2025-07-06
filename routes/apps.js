const express = require('express');
const { body, validationResult } = require('express-validator');
const App = require('../models/App');
const Deployment = require('../models/Deployment');
const deploymentService = require('../services/deployment');
const githubService = require('../services/github');
const logManager = require('../services/logManager');
const router = express.Router();

// Simple rate limiting for logs endpoint
const logRequestTimes = new Map();
const RATE_LIMIT_WINDOW = 5000; // 5 seconds
const MAX_REQUESTS_PER_WINDOW = 3;

// Get all apps for user
router.get('/', async (req, res) => {
  try {
    const apps = await App.find({ userId: req.user._id })
      .sort({ createdAt: -1 });
    
    res.json({ apps });
  } catch (error) {
    console.error('Error fetching apps:', error);
    res.status(500).json({ error: 'Failed to fetch apps' });
  }
});

// Create new app page
router.get('/new', (req, res) => {
  res.render('apps/new', { 
    title: 'Deploy New App',
    user: req.user 
  });
});

// Create new app
router.post('/', [
  body('name').trim().isLength({ min: 1 }).withMessage('App name is required'),
  body('repositoryId').notEmpty().withMessage('Repository must be selected'),
  body('startupCommand').trim().isLength({ min: 1 }).withMessage('Startup command is required'),
  body('buildCommand').optional().trim(),
  body('environmentVariables').optional().custom((value) => {
    if (value && value.trim()) {
      try {
        JSON.parse(value);
        return true;
      } catch (error) {
        throw new Error('Environment variables must be valid JSON');
      }
    }
    return true;
  })
], async (req, res) => {
  try {
    console.log('Request body:', req.body);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, repositoryId, startupCommand, buildCommand, environmentVariables } = req.body;
    
    // Get repository details from GitHub
    const repoData = await githubService.getUserRepositories(req.user.accessToken);
    const repos = repoData.repositories || repoData; // Handle both new and old format
    const repoIdNum = parseInt(repositoryId);
    const selectedRepo = repos.find(repo => repo.id === repoIdNum || repo.id.toString() === repositoryId);
    
    if (!selectedRepo) {
      return res.status(400).json({ error: 'Repository not found' });
    }

    // Get latest commit information
    let latestCommit = null;
    try {
      latestCommit = await githubService.getLatestCommit(
        req.user.accessToken,
        selectedRepo.owner,
        selectedRepo.name,
        selectedRepo.defaultBranch
      );
    } catch (error) {
      console.error('Error fetching latest commit:', error);
      // Continue without commit info if fetch fails
    }

    // Get available port
    const port = await deploymentService.getAvailablePort();
    
    // Generate subdomain if BASE_DOMAIN is configured
    let subdomain = null;
    if (process.env.BASE_DOMAIN) {
      try {
        const subdomainService = require('../services/subdomain');
        const subdomainResult = await subdomainService.reserveSubdomain(name, req.user._id);
        subdomain = subdomainResult.subdomain;
        console.log(`Generated subdomain for app "${name}": ${subdomain}`);
      } catch (error) {
        console.error('Error generating subdomain:', error);
        // Continue without subdomain if generation fails
      }
    }
    
    // Parse environment variables
    let envVars = new Map();
    if (environmentVariables && environmentVariables.trim()) {
      try {
        const parsed = JSON.parse(environmentVariables);
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          return res.status(400).json({ error: 'Environment variables must be a JSON object' });
        }
        envVars = new Map(Object.entries(parsed));
      } catch (error) {
        console.log('JSON parse error:', error.message);
        return res.status(400).json({ error: 'Invalid environment variables JSON: ' + error.message });
      }
    }

    // Create app
    const app = new App({
      name,
      userId: req.user._id,
      repository: {
        name: selectedRepo.name,
        fullName: selectedRepo.fullName,
        owner: selectedRepo.owner,
        url: selectedRepo.url,
        cloneUrl: selectedRepo.cloneUrl,
        branch: selectedRepo.defaultBranch,
        lastCommit: latestCommit ? {
          sha: latestCommit.sha,
          message: latestCommit.message,
          author: latestCommit.author.name,
          date: new Date(latestCommit.author.date),
          url: latestCommit.url
        } : null
      },
      configuration: {
        startupCommand,
        buildCommand: buildCommand || 'npm install',
        environmentVariables: envVars,
        port
      },
      subdomain
    });

    await app.save();
    
    res.status(201).json({ 
      message: 'App created successfully', 
      app: app._id 
    });
  } catch (error) {
    console.error('Error creating app:', error);
    res.status(500).json({ error: 'Failed to create app' });
  }
});

// Get app details
router.get('/:id', async (req, res) => {
  try {
    const app = await App.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });
    
    if (!app) {
      return res.status(404).render('404', {
        title: 'App Not Found',
        user: req.user
      });
    }
    
    const deployments = await Deployment.find({ appId: app._id })
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Prepare commit data for display
    if (app.repository.lastCommit && app.repository.lastCommit.sha) {
      app.repository.lastCommit.shortSha = app.repository.lastCommit.sha.substring(0, 7);
    }
    
    res.render('apps/details', {
      title: app.name + ' - App Details',
      user: req.user,
      app,
      deployments
    });
  } catch (error) {
    console.error('Error fetching app:', error);
    res.status(500).render('error', { 
      title: 'Error',
      error: 'Failed to load app details',
      user: req.user
    });
  }
});

// Deploy app
router.post('/:id/deploy', async (req, res) => {
  try {
    console.log(`Deploy request for app ${req.params.id} by user ${req.user._id}`);
    
    const app = await App.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });
    
    if (!app) {
      console.log('App not found for deployment');
      return res.status(404).json({ error: 'App not found' });
    }
    
    console.log(`Starting deployment for app: ${app.name}`);
    
    // Start deployment in background
    deploymentService.deployApp(app._id, req.user._id, req.user.accessToken)
      .catch(error => {
        console.error('Deployment failed:', error);
      });
    
    res.json({ 
      message: 'Deployment started', 
      appId: app._id 
    });
  } catch (error) {
    console.error('Error starting deployment:', error);
    res.status(500).json({ error: 'Failed to start deployment' });
  }
});

// Stop app
router.post('/:id/stop', async (req, res) => {
  try {
    const app = await App.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });
    
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    
    await deploymentService.stopApp(app._id);
    
    res.json({ message: 'App stopped successfully' });
  } catch (error) {
    console.error('Error stopping app:', error);
    res.status(500).json({ error: 'Failed to stop app' });
  }
});

// Restart app
router.post('/:id/restart', async (req, res) => {
  try {
    const app = await App.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });
    
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    
    await deploymentService.restartApp(app._id);
    
    res.json({ message: 'App restarted successfully' });
  } catch (error) {
    console.error('Error restarting app:', error);
    res.status(500).json({ error: 'Failed to restart app' });
  }
});

// Delete app
router.delete('/:id', async (req, res) => {
  try {
    const app = await App.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });
    
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    
    await deploymentService.deleteApp(app._id);
    
    res.json({ message: 'App deleted successfully' });
  } catch (error) {
    console.error('Error deleting app:', error);
    res.status(500).json({ error: 'Failed to delete app' });
  }
});

// Get app logs
router.get('/:id/logs', async (req, res) => {
  try {
    // Rate limiting
    const userId = req.user._id.toString();
    const now = Date.now();
    
    if (!logRequestTimes.has(userId)) {
      logRequestTimes.set(userId, []);
    }
    
    const userRequests = logRequestTimes.get(userId);
    // Remove old requests outside the window
    const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
    
    if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({ error: 'Too many requests. Please wait before fetching logs again.' });
    }
    
    // Add current request
    recentRequests.push(now);
    logRequestTimes.set(userId, recentRequests);
    
    const app = await App.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });
    
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const lines = parseInt(req.query.lines) || 100;
    
    const options = {
      page,
      pageSize,
      lines
    };
    
    const result = await deploymentService.getAppLogs(app._id, options);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Get deployment logs
router.get('/:id/deployments/:deploymentId/logs', async (req, res) => {
  try {
    const deployment = await Deployment.findOne({
      _id: req.params.deploymentId,
      appId: req.params.id,
      userId: req.user._id
    });
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }
    
    res.json({ logs: deployment.logs });
  } catch (error) {
    console.error('Error fetching deployment logs:', error);
    res.status(500).json({ error: 'Failed to fetch deployment logs' });
  }
});

// Check for newer commits
router.get('/:id/check-commits', async (req, res) => {
  try {
    const app = await App.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });
    
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    
    // Check if we have a last commit to compare against
    if (!app.repository.lastCommit || !app.repository.lastCommit.sha) {
      return res.json({ 
        hasNewerCommits: false, 
        message: 'No commit information available' 
      });
    }
    
    const result = await githubService.checkForNewerCommits(
      req.user.accessToken,
      app.repository.owner,
      app.repository.name,
      app.repository.branch,
      app.repository.lastCommit.sha
    );
    
    res.json(result);
  } catch (error) {
    console.error('Error checking for newer commits:', error);
    res.status(500).json({ error: 'Failed to check for newer commits' });
  }
});

// Manual log cleanup trigger (for testing)
router.post('/cleanup-logs', async (req, res) => {
  try {
    await logManager.triggerCleanup();
    res.json({ message: 'Log cleanup completed successfully' });
  } catch (error) {
    console.error('Error during manual log cleanup:', error);
    res.status(500).json({ error: 'Failed to cleanup logs' });
  }
});

module.exports = router; 