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
  subdomain: {
    type: String,
    unique: true,
    sparse: true, // Allows null values but ensures uniqueness for non-null values
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow null/undefined
        // Validate subdomain format: 3-20 chars, alphanumeric + hyphens, start/end with alphanumeric
        return /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$|^[a-z0-9]{3}$/.test(v);
      },
      message: 'Subdomain must be 3-20 characters, alphanumeric with hyphens, starting and ending with alphanumeric'
    }
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
// Note: subdomain index is created automatically by the 'unique: true' option

module.exports = mongoose.model('App', appSchema); 