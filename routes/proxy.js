const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const App = require('../models/App');
const router = express.Router();

// Middleware to log proxy requests for apps
router.use((req, res, next) => {
  console.log(`App Proxy request: ${req.method} ${req.originalUrl} from ${req.ip}`);
  next();
});

// Proxy route for app subdomains ONLY
router.use('/:subdomain', async (req, res, next) => {
  try {
    const subdomain = req.params.subdomain;
    
    // Validate subdomain format (stricter for apps)
    if (!/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$|^[a-z0-9]{3}$/.test(subdomain)) {
      return res.status(400).send(`
        <html>
          <head><title>Invalid App Subdomain</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
            <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h1 style="color: #e74c3c;">❌ Invalid App Subdomain</h1>
              <p style="color: #666;">The subdomain "${subdomain}" is not a valid app subdomain format.</p>
              <p style="color: #666; font-size: 14px;">App subdomains must be 3-20 characters, alphanumeric with hyphens allowed.</p>
            </div>
          </body>
        </html>
      `);
    }
    
    // Find app by subdomain
    const app = await App.findOne({ 
      subdomain, 
      'deployment.status': 'running' 
    });
    
    if (!app) {
      return res.status(404).send(`
        <html>
          <head><title>App Not Found</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
            <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h1 style="color: #e74c3c;">🔍 App Not Found</h1>
              <p style="color: #666;">The app <strong>"${subdomain}"</strong> is not found or not running.</p>
              <p style="color: #888; font-size: 14px;">This could mean:</p>
              <ul style="text-align: left; color: #666; font-size: 14px;">
                <li>The app doesn't exist</li>
                <li>The app is stopped</li>
                <li>The app is still deploying</li>
                <li>The app has failed to start</li>
              </ul>
            </div>
          </body>
        </html>
      `);
    }
    
    console.log(`Proxying request for subdomain: ${subdomain} to port: ${app.configuration.port}`);
    
    // Create proxy to the app's port
    const proxy = createProxyMiddleware({
      target: `http://localhost:${app.configuration.port}`,
      changeOrigin: true,
      pathRewrite: {
        [`^/proxy/${subdomain}`]: '',
      },
      onError: (err, req, res) => {
        console.error(`Proxy error for app ${subdomain} (port ${app.configuration.port}):`, err.message);
        res.status(502).send(`
          <html>
            <head><title>App Unavailable</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
              <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <h1 style="color: #f39c12;">⚠️ App Unavailable</h1>
                <p style="color: #666;">The app <strong>"${subdomain}"</strong> is temporarily unavailable.</p>
                <p style="color: #888; font-size: 14px;">Technical details: ${err.message}</p>
                <p style="color: #666; font-size: 14px;">Please try again in a few moments.</p>
              </div>
            </body>
          </html>
        `);
      },
      onProxyReq: (proxyReq, req, res) => {
        // Add custom headers for app identification
        proxyReq.setHeader('X-Forwarded-Subdomain', subdomain);
        proxyReq.setHeader('X-DeployIT-App-Proxy', 'true');
        proxyReq.setHeader('X-App-Name', app.name);
        proxyReq.setHeader('X-App-ID', app._id.toString());
      },
      onProxyRes: (proxyRes, req, res) => {
        // Add headers to identify this came through DeployIT
        proxyRes.headers['X-Powered-By'] = 'DeployIT-Platform';
        proxyRes.headers['X-App-Subdomain'] = subdomain;
      }
    });
    
    proxy(req, res, next);
  } catch (error) {
    console.error('Error in proxy route:', error);
    res.status(500).send(`
      <html>
        <head><title>Proxy Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
          <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h1 style="color: #e74c3c;">🚫 Proxy Error</h1>
            <p style="color: #666;">An error occurred while processing your request.</p>
            <p style="color: #888; font-size: 14px;">Please try again later.</p>
          </div>
        </body>
      </html>
    `);
  }
});

module.exports = router; 