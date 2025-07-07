const crypto = require('crypto');
const App = require('../models/App');

class SubdomainService {
  constructor() {
    this.maxRetries = 15; // Max attempts to generate unique subdomain
    this.reservedSubdomains = [
      'www', 'mail', 'ftp', 'ssh', 'admin', 'api', 'staging', 'dev', 'test',
      'blog', 'shop', 'store', 'app', 'portal', 'dashboard', 'control', 'manage',
      'system', 'root', 'secure', 'ssl', 'cdn', 'static', 'assets', 'media',
      'files', 'docs', 'support', 'help', 'status', 'monitor', 'health'
    ];
  }

  // Generate a 5-digit random number
  generate5DigitNumber() {
    return Math.floor(10000 + Math.random() * 90000).toString();
  }

  // Generate subdomain in format: NAME-5digits
  generateSubdomainFromName(appName) {
    // Clean app name: lowercase, remove special chars, limit length
    let cleanName = appName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 10); // Limit to 10 chars to leave room for -5digits
    
    // If empty after cleaning, use 'app' as default
    if (!cleanName || cleanName.length < 2) {
      cleanName = 'app';
    }
    
    // Generate 5-digit random number
    const randomNumber = this.generate5DigitNumber();
    
    // Combine: name-5digits
    const subdomain = `${cleanName}-${randomNumber}`;
    
    return subdomain;
  }

  // Check if subdomain is available and not reserved
  async isSubdomainAvailable(subdomain) {
    try {
      // Check if it's reserved
      if (this.reservedSubdomains.includes(subdomain.toLowerCase())) {
        return false;
      }
      
      // Check if already exists in database
      const existingApp = await App.findOne({ subdomain });
      return !existingApp;
    } catch (error) {
      console.error('Error checking subdomain availability:', error);
      return false;
    }
  }

  // Generate unique subdomain for an app in format NAME-5digits
  async generateUniqueSubdomain(appName, userId) {
    let attempts = 0;
    
    while (attempts < this.maxRetries) {
      // Always use the NAME-5digits format
      const subdomain = this.generateSubdomainFromName(appName);
      
      const isAvailable = await this.isSubdomainAvailable(subdomain);
      
      if (isAvailable && this.isValidSubdomain(subdomain)) {
        return subdomain;
      }
      
      attempts++;
    }
    
    // If all attempts failed, use timestamp-based fallback with app prefix
    const timestamp = Date.now().toString().slice(-5); // Last 5 digits
    return `app-${timestamp}`;
  }

  // Generate full URL from subdomain (with SSL support)
  generateSubdomainUrl(subdomain) {
    const baseDomain = process.env.BASE_DOMAIN;
    const hasSSL = process.env.APPS_SSL_ENABLED === 'true';
    const protocol = hasSSL ? 'https' : 'http';
    
    if (!baseDomain) {
      throw new Error('BASE_DOMAIN environment variable not set');
    }
    
    return `${protocol}://${subdomain}.${baseDomain}`;
  }

  // Validate subdomain format for apps
  isValidSubdomain(subdomain) {
    // App subdomain rules:
    // - 3-20 characters (to accommodate NAME-5digits format)
    // - Start and end with letter or number
    // - Can contain letters, numbers, hyphens
    // - Cannot be reserved
    // - Should follow NAME-5digits pattern
    const subdomainRegex = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$|^[a-z0-9]{3}$/;
    
    if (!subdomainRegex.test(subdomain)) {
      return false;
    }
    
    // Check against reserved list
    if (this.reservedSubdomains.includes(subdomain.toLowerCase())) {
      return false;
    }
    
    return true;
  }

  // Reserve a subdomain for an app
  async reserveSubdomain(appName, userId) {
    try {
      const subdomain = await this.generateUniqueSubdomain(appName, userId);
      
      if (!this.isValidSubdomain(subdomain)) {
        throw new Error('Generated subdomain is invalid');
      }
      
      console.log(`Reserved subdomain: ${subdomain} for app: ${appName}`);
      
      return {
        subdomain,
        url: this.generateSubdomainUrl(subdomain)
      };
    } catch (error) {
      console.error('Error reserving subdomain:', error);
      throw new Error('Failed to generate unique subdomain');
    }
  }

  // Release/cleanup subdomain when app is deleted
  async releaseSubdomain(subdomain) {
    try {
      if (!subdomain) {
        return true; // Nothing to release
      }
      
      console.log(`Releasing subdomain: ${subdomain}`);
      
      // The subdomain is automatically released when the app is deleted from DB
      // since it's tied to the app document. This function is for any additional
      // cleanup that might be needed (like cache clearing, etc.)
      
      return true;
    } catch (error) {
      console.error('Error releasing subdomain:', error);
      return false;
    }
  }

  // Get list of reserved subdomains
  getReservedSubdomains() {
    return [...this.reservedSubdomains];
  }

  // Get all active subdomains (for monitoring/debugging)
  async getActiveSubdomains() {
    try {
      const apps = await App.find({ subdomain: { $ne: null } }, 'name subdomain');
      return apps.map(app => ({
        name: app.name,
        subdomain: app.subdomain,
        url: this.generateSubdomainUrl(app.subdomain)
      }));
    } catch (error) {
      console.error('Error fetching active subdomains:', error);
      return [];
    }
  }
}

module.exports = new SubdomainService(); 