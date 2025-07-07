const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const helmet = require('helmet');
// const rateLimit = require('express-rate-limit'); // REMOVED: Rate limiting disabled
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const http = require('http');
const socketIo = require('socket.io');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();

// Set NODE_ENV to development by default for easier debugging
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

// Import routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const appRoutes = require('./routes/apps');
const repoRoutes = require('./routes/repos');

// Conditionally import proxy route if BASE_DOMAIN is configured
let proxyRoutes = null;
if (process.env.BASE_DOMAIN) {
  try {
    proxyRoutes = require('./routes/proxy');
  } catch (error) {
    console.warn('Proxy route not available - subdomain functionality disabled');
  }
}

// Import services
const database = require('./services/database');
const socketService = require('./services/socket');
const logManager = require('./services/logManager');

// Import middleware
const authMiddleware = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Trust proxy - required when behind reverse proxy (Nginx, Cloudflare, etc.)
app.set('trust proxy', true);

// Connect to database
database.connect();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdn.socket.io"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://avatars.githubusercontent.com"],
      connectSrc: ["'self'", "wss:", "ws:"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"]
    }
  }
}));

// Rate limiting - REMOVED
// const limiter = rateLimit({
//   windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
//   max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
//   message: 'Too many requests from this IP, please try again later.'
// });
// app.use(limiter); // REMOVED: Rate limiting disabled

// General middleware
app.use(cors());
app.use(compression());
// Only log errors and important requests in production
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport configuration
require('./config/passport');
app.use(passport.initialize());
app.use(passport.session());

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io setup
socketService.initialize(io);

// Routes
app.use('/auth', authRoutes);
app.use('/dashboard', authMiddleware.requireAuth, dashboardRoutes);
app.use('/apps', authMiddleware.requireAuth, appRoutes);
app.use('/repos', authMiddleware.requireAuth, repoRoutes);

// Proxy route for app subdomains (if configured)
if (proxyRoutes) {
  app.use('/proxy', proxyRoutes);
}

// Home route
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.render('index', { 
    title: 'Home',
    user: req.user,
    layout: false // Index has its own HTML structure
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { 
    title: 'Error',
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong!' : err.message,
    user: req.user || null
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', {
    title: 'Page Not Found',
    user: req.user || null
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app; 