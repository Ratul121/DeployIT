const express = require('express');
const App = require('../models/App');
const Deployment = require('../models/Deployment');
const router = express.Router();

// Dashboard home page
router.get('/', async (req, res) => {
  try {
    const apps = await App.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(10);
    
    const recentDeployments = await Deployment.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('appId', 'name');
    
    const stats = {
      totalApps: await App.countDocuments({ userId: req.user._id }),
      runningApps: await App.countDocuments({ 
        userId: req.user._id, 
        'deployment.status': 'running' 
      }),
      totalDeployments: await Deployment.countDocuments({ userId: req.user._id }),
      failedDeployments: await Deployment.countDocuments({ 
        userId: req.user._id, 
        status: 'failed' 
      })
    };
    
    res.render('dashboard', {
      title: 'Dashboard',
      user: req.user,
      apps,
      recentDeployments,
      stats
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error', { 
      title: 'Error',
      error: 'Failed to load dashboard',
      user: req.user
    });
  }
});

module.exports = router; 