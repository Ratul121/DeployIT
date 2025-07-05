class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map();
  }

  initialize(io) {
    this.io = io;
    
    io.on('connection', (socket) => {
      // Only log in development mode
      if (process.env.NODE_ENV === 'development') {
        console.log('User connected:', socket.id);
      }
      
      // Handle user authentication for socket
      socket.on('authenticate', (data) => {
        if (data.userId) {
          this.connectedUsers.set(socket.id, data.userId);
          socket.join(`user_${data.userId}`);
        }
      });

      // Handle joining app-specific rooms for logs
      socket.on('join_app', (data) => {
        if (data.appId) {
          socket.join(`app_${data.appId}`);
          if (process.env.NODE_ENV === 'development') {
            console.log(`User joined app room: app_${data.appId}`);
          }
        }
      });

      // Handle leaving app-specific rooms
      socket.on('leave_app', (data) => {
        if (data.appId) {
          socket.leave(`app_${data.appId}`);
          if (process.env.NODE_ENV === 'development') {
            console.log(`User left app room: app_${data.appId}`);
          }
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        if (process.env.NODE_ENV === 'development') {
          console.log('User disconnected:', socket.id);
        }
        this.connectedUsers.delete(socket.id);
      });
    });
  }

  // Emit deployment logs to specific app room
  emitDeploymentLog(appId, logData) {
    if (this.io) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`Emitting deployment log to app_${appId}:`, logData);
      }
      this.io.to(`app_${appId}`).emit('deployment_log', {
        appId,
        timestamp: new Date(),
        ...logData
      });
    } else {
      console.error('Socket.io not initialized - cannot emit deployment log');
    }
  }

  // Emit deployment status updates
  emitDeploymentStatus(appId, status) {
    if (this.io) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`Emitting deployment status to app_${appId}:`, status);
      }
      this.io.to(`app_${appId}`).emit('deployment_status', {
        appId,
        status,
        timestamp: new Date()
      });
    } else {
      console.error('Socket.io not initialized - cannot emit deployment status');
    }
  }

  // Emit app status updates
  emitAppStatus(appId, status) {
    if (this.io) {
      this.io.to(`app_${appId}`).emit('app_status', {
        appId,
        status,
        timestamp: new Date()
      });
    }
  }

  // Emit notifications to specific user
  emitNotification(userId, notification) {
    if (this.io) {
      this.io.to(`user_${userId}`).emit('notification', {
        ...notification,
        timestamp: new Date()
      });
    }
  }

  // Emit real-time logs for running apps
  emitAppLog(appId, logData) {
    if (this.io) {
      this.io.to(`app_${appId}`).emit('app_log', {
        appId,
        timestamp: new Date(),
        ...logData
      });
    }
  }

  // Get connected users count
  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  // Check if user is connected
  isUserConnected(userId) {
    return Array.from(this.connectedUsers.values()).includes(userId);
  }
}

module.exports = new SocketService(); 