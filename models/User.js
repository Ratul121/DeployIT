const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  githubId: {
    type: String,
    required: true,
    unique: true
  },
  username: {
    type: String,
    required: true
  },
  displayName: {
    type: String,
    required: false,
    default: function() {
      return this.username || 'GitHub User';
    }
  },
  email: {
    type: String,
    default: null
  },
  avatarUrl: {
    type: String,
    default: null
  },
  accessToken: {
    type: String,
    required: true
  },
  profileUrl: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema); 