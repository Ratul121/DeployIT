const mongoose = require('mongoose');

const deploymentSchema = new mongoose.Schema({
  appId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'App',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'success', 'failed'],
    default: 'pending'
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date,
    default: null
  },
  logs: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    level: {
      type: String,
      enum: ['info', 'warn', 'error', 'debug'],
      default: 'info'
    },
    message: {
      type: String,
      required: true
    }
  }],
  error: {
    type: String,
    default: null
  },
  commitHash: {
    type: String,
    default: null
  },
  branch: {
    type: String,
    default: 'main'
  }
}, {
  timestamps: true
});

// Index for efficient queries
deploymentSchema.index({ appId: 1, createdAt: -1 });
deploymentSchema.index({ userId: 1, createdAt: -1 });
deploymentSchema.index({ status: 1 });

module.exports = mongoose.model('Deployment', deploymentSchema); 