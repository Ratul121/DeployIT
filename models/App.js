const mongoose = require('mongoose');

const appSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  repository: {
    name: {
      type: String,
      required: true
    },
    fullName: {
      type: String,
      required: true
    },
    owner: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    cloneUrl: {
      type: String,
      required: true
    },
    branch: {
      type: String,
      default: 'main'
    },
    lastCommit: {
      sha: {
        type: String,
        default: null
      },
      message: {
        type: String,
        default: null
      },
      author: {
        type: String,
        default: null
      },
      date: {
        type: Date,
        default: null
      },
      url: {
        type: String,
        default: null
      }
    }
  },
  configuration: {
    startupCommand: {
      type: String,
      default: 'npm start'
    },
    environmentVariables: {
      type: Map,
      of: String,
      default: {}
    },
    port: {
      type: Number,
      required: true
    },
    buildCommand: {
      type: String,
      default: 'npm install'
    }
  },
  deployment: {
    status: {
      type: String,
      enum: ['pending', 'building', 'running', 'stopped', 'failed'],
      default: 'pending'
    },
    pm2Id: {
      type: String,
      default: null
    },
    deployedAt: {
      type: Date,
      default: null
    },
    lastDeployment: {
      type: Date,
      default: null
    },
    deploymentCount: {
      type: Number,
      default: 0
    },
    lastError: {
      type: String,
      default: null
    },
    lastErrorAt: {
      type: Date,
      default: null
    }
  },
  url: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
appSchema.index({ userId: 1, createdAt: -1 });
appSchema.index({ 'deployment.status': 1 });

module.exports = mongoose.model('App', appSchema); 