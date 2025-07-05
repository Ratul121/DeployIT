const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  
  // If it's an API request, return JSON error
  if (req.path.startsWith('/api/') || req.xhr) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // For regular requests, redirect to login
  res.redirect('/');
};

const requireNoAuth = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }
  
  // If user is already authenticated, redirect to dashboard
  res.redirect('/dashboard');
};

const attachUser = (req, res, next) => {
  res.locals.user = req.user || null;
  next();
};

module.exports = {
  requireAuth,
  requireNoAuth,
  attachUser
}; 