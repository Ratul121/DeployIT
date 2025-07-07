#!/bin/bash

# Apps-Only Domain Setup Script for DeployIT Platform
# Usage: ./setup-domain.sh yourdomain.com [email]
# This script sets up HTTPS subdomain routing for deployed apps with wildcard SSL
# (Main domain SSL is handled separately)

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to get server IP
get_server_ip() {
    local ip
    ip=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "")
    echo "$ip"
}

# Function to validate domain format
validate_domain() {
    local domain="$1"
    if [[ ! "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$ ]]; then
        return 1
    fi
    return 0
}

# Function to backup existing nginx config
backup_nginx_config() {
    local domain="$1"
    local config_file="/etc/nginx/sites-available/${domain}-apps"
    
    if [ -f "$config_file" ]; then
        print_warning "Existing config found. Creating backup..."
        sudo cp "$config_file" "${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
}

# Function to install certbot if needed
install_certbot() {
    if ! command_exists certbot; then
        print_status "Installing Certbot for SSL certificates..."
        
        # Update package list
        sudo apt update
        
        # Install certbot and nginx plugin
        sudo apt install -y certbot python3-certbot-nginx
        
        print_success "Certbot installed successfully"
    else
        print_success "Certbot already installed"
    fi
}

# Function to create nginx configuration for apps with SSL
create_nginx_config_with_ssl() {
    local domain="$1"
    local config_file="/etc/nginx/sites-available/${domain}-apps"
    
    print_status "Creating Nginx configuration for app subdomains with SSL..."
    
    sudo tee "$config_file" > /dev/null <<EOF
# DeployIT Platform - App Subdomains Configuration for $domain
# Generated on $(date)
# This config handles app subdomains with wildcard SSL
# Main domain SSL is handled separately

# Rate limiting zone for app subdomains - REMOVED
# limit_req_zone \$binary_remote_addr zone=app_limit:10m rate=10r/s;

# HTTP server - redirect to HTTPS for app subdomains only
server {
    listen 80;
    server_name *.$domain;
    
    # Let's Encrypt verification path
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files \$uri =404;
    }
    
    # Redirect all app subdomains to HTTPS
    location / {
        # Extract subdomain
        set \$subdomain "";
        if (\$host ~* "^(.+)\\.$domain\$") {
            set \$subdomain \$1;
        }
        
        # Only redirect app subdomains (not main domain)
        if (\$subdomain != "") {
            return 301 https://\$host\$request_uri;
        }
        
        # If no subdomain, return 404 (this shouldn't handle main domain)
        return 404;
    }
}

# HTTPS server for app subdomains
server {
    listen 443 ssl http2;
    server_name *.$domain;
    
    # SSL Configuration - Wildcard certificate for all subdomains
    ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
    
    # SSL Security Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Rate limiting for app requests - REMOVED
    # limit_req zone=app_limit burst=20 nodelay;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    location / {
        # Extract subdomain
        set \$subdomain "";
        if (\$host ~* "^(.+)\\.$domain\$") {
            set \$subdomain \$1;
        }
        
        # Block reserved/system subdomains
        if (\$subdomain ~* "^(www|mail|ftp|ssh|admin|api|staging|dev|test|blog|shop|store|app|portal|dashboard|control|manage|system|root|secure|ssl|cdn|static|assets|media|files|docs|support|help|status|monitor|health)\$") {
            return 403 "Reserved subdomain - cannot be used for apps";
        }
        
        # Only allow app subdomains (alphanumeric + hyphen, 3-20 chars)
        if (\$subdomain !~ "^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]\$") {
            return 400 "Invalid app subdomain format";
        }
        
        # Proxy to the DeployIT platform proxy route
        proxy_pass http://localhost:3000/proxy/\$subdomain;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Subdomain \$subdomain;
        proxy_set_header X-Original-Host \$host;
        proxy_set_header X-App-Request "true";
        
        # WebSocket support for apps
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Timeouts optimized for apps
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 300s;
        
        # Buffer settings for better performance
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        
        # Error handling
        proxy_intercept_errors on;
        error_page 502 503 504 /app_error.html;
    }
    
    # Custom error page for app errors
    location = /app_error.html {
        internal;
        return 502 '<!DOCTYPE html>
<html>
<head>
    <title>App Unavailable</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
        .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #e74c3c; margin-bottom: 20px; }
        p { color: #666; line-height: 1.6; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚫 App Unavailable</h1>
        <p>The requested app subdomain is currently unavailable.</p>
        <p>This could be because:</p>
        <ul style="text-align: left; color: #666;">
            <li>The app is starting up</li>
            <li>The app has crashed</li>
            <li>The app is being deployed</li>
            <li>The subdomain does not exist</li>
        </ul>
        <p>Please try again in a few moments.</p>
    </div>
</body>
</html>';
        add_header Content-Type text/html;
    }
    
    # Health check for app proxy
    location /app-proxy-health {
        access_log off;
        return 200 "app-proxy-healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

    print_success "Nginx configuration created with SSL support: $config_file"
}

# Function to create HTTP-only nginx configuration (fallback)
create_nginx_config_http_only() {
    local domain="$1"
    local config_file="/etc/nginx/sites-available/${domain}-apps"
    
    print_status "Creating HTTP-only Nginx configuration for app subdomains..."
    
    sudo tee "$config_file" > /dev/null <<EOF
# DeployIT Platform - App Subdomains Configuration for $domain
# Generated on $(date)
# This config handles app subdomains with HTTP only (SSL failed)
# Main domain SSL is handled separately

# Rate limiting zone for app subdomains - REMOVED
# limit_req_zone \$binary_remote_addr zone=app_limit:10m rate=10r/s;

# HTTP server for app subdomains
server {
    listen 80;
    server_name *.$domain;
    
    # Rate limiting for app requests - REMOVED
    # limit_req zone=app_limit burst=20 nodelay;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    location / {
        # Extract subdomain
        set \$subdomain "";
        if (\$host ~* "^(.+)\\.$domain\$") {
            set \$subdomain \$1;
        }
        
        # Block reserved/system subdomains
        if (\$subdomain ~* "^(www|mail|ftp|ssh|admin|api|staging|dev|test|blog|shop|store|app|portal|dashboard|control|manage|system|root|secure|ssl|cdn|static|assets|media|files|docs|support|help|status|monitor|health)\$") {
            return 403 "Reserved subdomain - cannot be used for apps";
        }
        
        # Only allow app subdomains (alphanumeric + hyphen, 3-20 chars)
        if (\$subdomain !~ "^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]\$") {
            return 400 "Invalid app subdomain format";
        }
        
        # Proxy to the DeployIT platform proxy route
        proxy_pass http://localhost:3000/proxy/\$subdomain;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Subdomain \$subdomain;
        proxy_set_header X-Original-Host \$host;
        proxy_set_header X-App-Request "true";
        
        # WebSocket support for apps
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Timeouts optimized for apps
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 300s;
        
        # Buffer settings for better performance
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        
        # Error handling
        proxy_intercept_errors on;
        error_page 502 503 504 /app_error.html;
    }
    
    # Custom error page for app errors
    location = /app_error.html {
        internal;
        return 502 '<!DOCTYPE html>
<html>
<head>
    <title>App Unavailable</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
        .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #e74c3c; margin-bottom: 20px; }
        p { color: #666; line-height: 1.6; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚫 App Unavailable</h1>
        <p>The requested app subdomain is currently unavailable.</p>
        <p>This could be because:</p>
        <ul style="text-align: left; color: #666;">
            <li>The app is starting up</li>
            <li>The app has crashed</li>
            <li>The app is being deployed</li>
            <li>The subdomain does not exist</li>
        </ul>
        <p>Please try again in a few moments.</p>
    </div>
</body>
</html>';
        add_header Content-Type text/html;
    }
    
    # Health check for app proxy
    location /app-proxy-health {
        access_log off;
        return 200 "app-proxy-healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

    print_success "HTTP-only Nginx configuration created: $config_file"
}

# Function to setup wildcard SSL certificate for app subdomains
setup_wildcard_ssl() {
    local domain="$1"
    local email="${2:-admin@$domain}"
    
    print_status "Setting up wildcard SSL certificate for app subdomains (*.$domain)..."
    print_status "Using email: $email"
    
    # Create webroot directory for verification
    sudo mkdir -p /var/www/html
    
    # First, create HTTP-only config for domain verification
    create_nginx_config_http_only "$domain"
    
    # Test and reload nginx
    if ! sudo nginx -t; then
        print_error "Nginx configuration test failed!"
        return 1
    fi
    
    sudo systemctl reload nginx
    
    print_status "Attempting to obtain wildcard SSL certificate..."
    print_warning "This requires DNS verification. You'll need to add a TXT record."
    
    # Get wildcard certificate using manual DNS challenge
    if sudo certbot certonly \
        --manual \
        --preferred-challenges dns \
        --email "$email" \
        --agree-tos \
        --no-eff-email \
        --expand \
        -d "*.$domain"; then
        
        print_success "Wildcard SSL certificate obtained successfully!"
        
        # Now create the SSL-enabled configuration
        create_nginx_config_with_ssl "$domain"
        
        # Test nginx configuration with SSL
        if sudo nginx -t; then
            sudo systemctl reload nginx
            print_success "SSL configuration activated for app subdomains!"
            
            # Setup auto-renewal
            setup_ssl_renewal "$domain"
            
            return 0
        else
            print_error "SSL configuration test failed!"
            print_warning "Falling back to HTTP-only configuration..."
            create_nginx_config_http_only "$domain"
            sudo nginx -t && sudo systemctl reload nginx
            return 1
        fi
        
    else
        print_error "Failed to obtain wildcard SSL certificate"
        print_warning "Continuing with HTTP-only configuration for app subdomains..."
        
        # Keep HTTP-only config
        create_nginx_config_http_only "$domain"
        sudo nginx -t && sudo systemctl reload nginx
        return 1
    fi
}

# Function to setup SSL certificate auto-renewal
setup_ssl_renewal() {
    local domain="$1"
    
    print_status "Setting up SSL certificate auto-renewal..."
    
    # Create renewal hook script
    sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
    sudo tee /etc/letsencrypt/renewal-hooks/deploy/nginx-reload.sh > /dev/null <<'EOF'
#!/bin/bash
systemctl reload nginx
EOF
    
    sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/nginx-reload.sh
    
    # Test renewal process
    if sudo certbot renew --dry-run; then
        print_success "SSL auto-renewal configured successfully"
        print_status "Certificates will auto-renew via systemd timer"
    else
        print_warning "SSL auto-renewal test failed, but certificates are still valid"
    fi
}

# Function to enable nginx site
enable_nginx_site() {
    local domain="$1"
    local config_file="${domain}-apps"
    local enabled_file="/etc/nginx/sites-enabled/$config_file"
    
    print_status "Enabling Nginx site for app subdomains..."
    
    # Remove existing symlink if it exists
    if [ -L "$enabled_file" ]; then
        sudo rm "$enabled_file"
    fi
    
    # Create new symlink
    sudo ln -s "/etc/nginx/sites-available/$config_file" "$enabled_file"
    
    print_success "Nginx site enabled for app subdomains"
}

# Function to test and reload nginx
reload_nginx() {
    print_status "Testing Nginx configuration..."
    
    if sudo nginx -t; then
        print_success "Nginx configuration test passed"
        print_status "Reloading Nginx..."
        sudo systemctl reload nginx
        print_success "Nginx reloaded successfully"
    else
        print_error "Nginx configuration test failed!"
        return 1
    fi
}

# Function to update environment file
update_env_file() {
    local domain="$1"
    local has_ssl="$2"
    local env_file=".env"
    
    print_status "Updating environment configuration..."
    
    # Backup existing .env
    if [ -f "$env_file" ]; then
        cp "$env_file" "${env_file}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    # Update or add BASE_DOMAIN
    if grep -q "^BASE_DOMAIN=" "$env_file" 2>/dev/null; then
        sed -i "s/^BASE_DOMAIN=.*/BASE_DOMAIN=$domain/" "$env_file"
    else
        echo "BASE_DOMAIN=$domain" >> "$env_file"
    fi
    
    # Add apps-only flag
    if grep -q "^APPS_ONLY_SUBDOMAINS=" "$env_file" 2>/dev/null; then
        sed -i "s/^APPS_ONLY_SUBDOMAINS=.*/APPS_ONLY_SUBDOMAINS=true/" "$env_file"
    else
        echo "APPS_ONLY_SUBDOMAINS=true" >> "$env_file"
    fi
    
    # Add SSL flag for apps
    if grep -q "^APPS_SSL_ENABLED=" "$env_file" 2>/dev/null; then
        sed -i "s/^APPS_SSL_ENABLED=.*/APPS_SSL_ENABLED=$has_ssl/" "$env_file"
    else
        echo "APPS_SSL_ENABLED=$has_ssl" >> "$env_file"
    fi
    
    # Ensure NODE_ENV is set for production
    if ! grep -q "^NODE_ENV=" "$env_file" 2>/dev/null; then
        echo "NODE_ENV=production" >> "$env_file"
    fi
    
    local ssl_status="HTTP only"
    if [ "$has_ssl" = "true" ]; then
        ssl_status="HTTPS with wildcard SSL"
    fi
    
    print_success "Environment file updated with BASE_DOMAIN=$domain (apps only, $ssl_status)"
}

# Function to install required packages
install_dependencies() {
    print_status "Installing required Node.js packages..."
    
    # Check if package.json exists
    if [ ! -f "package.json" ]; then
        print_error "package.json not found in current directory"
        return 1
    fi
    
    # Install http-proxy-middleware if not already installed
    if ! npm list http-proxy-middleware >/dev/null 2>&1; then
        print_status "Installing http-proxy-middleware..."
        npm install http-proxy-middleware
        print_success "http-proxy-middleware installed"
    else
        print_success "http-proxy-middleware already installed"
    fi
}

# Function to create subdomain service (apps only version with SSL support)
create_subdomain_service() {
    local has_ssl="$1"
    local service_file="services/subdomain.js"
    
    if [ -f "$service_file" ]; then
        # Check if the file already has the improved NAME-5digits format
        if grep -q "generate5DigitNumber" "$service_file" && grep -q "releaseSubdomain" "$service_file"; then
            print_success "Subdomain service already exists with NAME-5digits format - skipping creation"
            return 0
        fi
        print_warning "Subdomain service already exists, creating improved NAME-5digits version..."
        cp "$service_file" "${service_file}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    print_status "Creating apps-only subdomain service with SSL support..."
    
    mkdir -p services
    
    cat > "$service_file" <<EOF
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
    const subdomain = \`\${cleanName}-\${randomNumber}\`;
    
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
    return \`app-\${timestamp}\`;
  }

  // Generate full URL from subdomain (with SSL support)
  generateSubdomainUrl(subdomain) {
    const baseDomain = process.env.BASE_DOMAIN;
    const hasSSL = process.env.APPS_SSL_ENABLED === 'true';
    const protocol = hasSSL ? 'https' : 'http';
    
    if (!baseDomain) {
      throw new Error('BASE_DOMAIN environment variable not set');
    }
    
    return \`\${protocol}://\${subdomain}.\${baseDomain}\`;
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
      
      console.log(\`Reserved subdomain: \${subdomain} for app: \${appName}\`);
      
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
      
      console.log(\`Releasing subdomain: \${subdomain}\`);
      
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
      const apps = await App.find({ subdomain: { \$ne: null } }, 'name subdomain');
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
EOF

    print_success "Apps-only subdomain service created with SSL support: $service_file"
}

# Function to create proxy route (same as before but with better error handling)
create_proxy_route() {
    local route_file="routes/proxy.js"
    
    if [ -f "$route_file" ]; then
        print_warning "Proxy route already exists, creating apps-only version..."
        cp "$route_file" "${route_file}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    print_status "Creating apps-only proxy route..."
    
    mkdir -p routes
    
    cat > "$route_file" <<'EOF'
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
    console.error('App proxy route error:', error);
    res.status(500).send(`
      <html>
        <head><title>Proxy Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
          <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h1 style="color: #e74c3c;">🚨 Proxy Error</h1>
            <p style="color: #666;">An error occurred while routing to the app.</p>
            <p style="color: #888; font-size: 14px;">Please contact support if this persists.</p>
          </div>
        </body>
      </html>
    `);
  }
});

module.exports = router;
EOF

    print_success "Apps-only proxy route created: $route_file"
}

# Function to display DNS configuration instructions
show_dns_instructions() {
    local domain="$1"
    local server_ip="$2"
    local has_ssl="$3"
    
    echo ""
    print_success "=== APPS-ONLY SUBDOMAIN SETUP COMPLETED ==="
    echo ""
    print_warning "IMPORTANT: Configure this DNS record:"
    echo ""
    echo "┌─────────────────────────────────────────────────────────┐"
    echo "│               DNS RECORD FOR APP SUBDOMAINS            │"
    echo "├─────────────────────────────────────────────────────────┤"
    echo "│ Type: A Record                                          │"
    echo "│ Host: *                                                 │"
    echo "│ Value: $server_ip                                       │"
    echo "│ TTL: Automatic                                          │"
    echo "└─────────────────────────────────────────────────────────┘"
    echo ""
    print_status "This wildcard record (*) will route ALL subdomains to your server."
    print_warning "Your main site subdomain routing is NOT affected by this setup."
    echo ""
    
    if [ "$has_ssl" = "true" ]; then
        print_status "After DNS propagation (5-30 minutes), your app URLs will be:"
        echo "  • App subdomains: https://myapp123.$domain"
        echo "  • Another app: https://blog456.$domain"
        echo "  • Random app: https://x7k9m2.$domain"
        echo ""
        print_status "SSL Features:"
        echo "  • ✅ Automatic HTTPS for all app subdomains"
        echo "  • ✅ Wildcard SSL certificate covers all apps"
        echo "  • ✅ Auto-renewal every 60 days"
        echo "  • ✅ Modern TLS 1.2/1.3 security"
        echo "  • ✅ HTTP to HTTPS redirect"
    else
        print_status "After DNS propagation (5-30 minutes), your app URLs will be:"
        echo "  • App subdomains: http://myapp123.$domain"
        echo "  • Another app: http://blog456.$domain"
        echo "  • Random app: http://x7k9m2.$domain"
        echo ""
        print_status "SSL Configuration:"
        echo "  • ❌ SSL certificate setup failed"
        echo "  • ℹ️  Apps will use HTTP (less secure)"
        echo "  • ℹ️  You can run the script again to retry SSL setup"
    fi
    
    echo ""
    print_status "Reserved subdomains that WON'T be used for apps:"
    echo "  www, mail, ftp, ssh, admin, api, staging, dev, test, blog,"
    echo "  shop, store, app, portal, dashboard, control, manage, etc."
    echo ""
    print_status "Test DNS propagation with:"
    echo "  nslookup test123.$domain"
    echo ""
}

# Function to restart services
restart_services() {
    print_status "Restarting application services..."
    
    # Check if PM2 is running the main app
    if pm2 list | grep -q "deployit-app"; then
        pm2 restart deployit-app
        print_success "DeployIT app restarted"
    else
        print_warning "DeployIT app not found in PM2. Please start it manually."
    fi
    
    # Save PM2 processes
    pm2 save
    print_success "PM2 processes saved"
}

# Main script execution
main() {
    echo ""
    echo "🎯 DeployIT Platform - Apps-Only Subdomain Setup with SSL"
    echo "========================================================="
    echo ""
    
    # Check if domain is provided
    if [ $# -eq 0 ]; then
        print_error "Usage: $0 <domain.com> [email]"
        print_error "Example: $0 mydomain.com admin@mydomain.com"
        print_error "Example: $0 mydomain.com (uses admin@mydomain.com)"
        print_error ""
        print_status "This script sets up HTTPS subdomain routing for deployed apps."
        print_status "Your main site routing and SSL will remain unchanged."
        print_status "A wildcard SSL certificate will be created for all app subdomains."
        exit 1
    fi
    
    local domain="$1"
    local email="${2:-admin@$domain}"
    
    # Validate domain format
    if ! validate_domain "$domain"; then
        print_error "Invalid domain format: $domain"
        print_error "Please provide a valid domain (e.g., mydomain.com)"
        exit 1
    fi
    
    print_status "Setting up HTTPS app subdomains for: $domain"
    print_status "SSL email: $email"
    print_warning "Main domain routing and SSL will NOT be affected"
    
    # Check if running as root for nginx operations
    if [ "$EUID" -ne 0 ]; then
        print_error "This script requires sudo privileges for Nginx configuration"
        print_error "Please run: sudo $0 $domain"
        exit 1
    fi
    
    # Check required commands
    local missing_commands=()
    
    if ! command_exists nginx; then
        missing_commands+=("nginx")
    fi
    
    if ! command_exists npm; then
        missing_commands+=("npm")
    fi
    
    if ! command_exists pm2; then
        missing_commands+=("pm2")
    fi
    
    if [ ${#missing_commands[@]} -ne 0 ]; then
        print_error "Missing required commands: ${missing_commands[*]}"
        print_error "Please install them first"
        exit 1
    fi
    
    # Get server IP
    local server_ip
    server_ip=$(get_server_ip)
    
    if [ -z "$server_ip" ]; then
        print_error "Could not determine server IP address"
        exit 1
    fi
    
    print_status "Server IP detected: $server_ip"
    
    # Execute setup steps
    backup_nginx_config "$domain"
    
    # Install certbot
    install_certbot
    
    # Try to setup wildcard SSL certificate
    local has_ssl="false"
    if setup_wildcard_ssl "$domain" "$email"; then
        has_ssl="true"
        print_success "SSL setup completed successfully!"
    else
        print_warning "SSL setup failed, continuing with HTTP-only setup"
    fi
    
    enable_nginx_site "$domain"
    
    # Switch to non-root user for Node.js operations
    local original_user="${SUDO_USER:-$USER}"
    if [ "$original_user" != "root" ]; then
        print_status "Switching to user: $original_user"
        
        # Update environment as original user
        sudo -u "$original_user" bash -c "$(declare -f update_env_file print_status print_success); update_env_file '$domain' '$has_ssl'"
        
        # Install dependencies as original user
        sudo -u "$original_user" bash -c "$(declare -f install_dependencies print_status print_success print_error); install_dependencies"
        
        # Create service files as original user
        sudo -u "$original_user" bash -c "$(declare -f create_subdomain_service print_status print_success print_warning); create_subdomain_service '$has_ssl'"
        sudo -u "$original_user" bash -c "$(declare -f create_proxy_route print_status print_success print_warning); create_proxy_route"
        
        # Restart services as original user
        sudo -u "$original_user" bash -c "$(declare -f restart_services print_status print_success print_warning); restart_services"
    else
        update_env_file "$domain" "$has_ssl"
        install_dependencies
        create_subdomain_service "$has_ssl"
        create_proxy_route
        restart_services
    fi
    
    # Show DNS instructions
    show_dns_instructions "$domain" "$server_ip" "$has_ssl"
    
    if [ "$has_ssl" = "true" ]; then
        print_success "Apps-only HTTPS subdomain setup completed successfully!"
        print_status "🔒 All new apps will automatically get HTTPS subdomains!"
    else
        print_success "Apps-only HTTP subdomain setup completed!"
        print_status "ℹ️  Apps will use HTTP. You can run the script again to retry SSL setup."
    fi
    
    print_status "Only deployed apps will get subdomains - main site unaffected!"
}

# Run main function with all arguments
main "$@" 