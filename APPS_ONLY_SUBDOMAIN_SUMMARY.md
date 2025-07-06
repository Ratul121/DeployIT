# Apps-Only Subdomain Implementation Summary

## Overview
Successfully implemented automatic subdomain assignment for deployed apps while keeping the main DeployIT platform on its own subdomain. This allows users to have their main site on `app.yourdomain.com` while deployed apps get automatic subdomains like `myapp.yourdomain.com`.

## Files Modified/Created

### 1. Setup Script & Documentation
- **`setup-domain-apps-only.sh`** - Automated setup script for apps-only subdomain routing
- **`DOMAIN_SETUP_APPS_ONLY.md`** - Complete documentation and troubleshooting guide

### 2. Backend Implementation
- **`models/App.js`** - Added `subdomain` field with validation and unique constraint
- **`services/subdomain.js`** - Apps-only subdomain service with generation and validation
- **`routes/proxy.js`** - Proxy route for handling app subdomain requests
- **`routes/apps.js`** - Modified app creation to generate subdomains
- **`services/deployment.js`** - Updated to use subdomain URLs when available
- **`server.js`** - Added conditional proxy route registration

### 3. Frontend Updates
- **`views/apps/details.ejs`** - Added subdomain display section in app information
- **`views/dashboard.ejs`** - Added subdomain indicators to app cards

## Key Features

### Subdomain Generation
- **From app name**: `my-blog-app` → `myblogapp123.yourdomain.com`
- **Random fallback**: `x7k9m2.yourdomain.com` (if name-based fails)
- **Reserved blocking**: Prevents use of `www`, `admin`, `mail`, etc.

### Nginx Configuration
- **Wildcard routing**: `*.yourdomain.com` → DeployIT proxy
- **Format validation**: Only allows valid app subdomain formats
- **Error handling**: Custom error pages for missing/failed apps
- **Security**: Rate limiting and reserved subdomain blocking

### Database Schema
```javascript
subdomain: {
  type: String,
  unique: true,
  sparse: true, // Allows null but ensures uniqueness
  validate: {
    validator: /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$|^[a-z0-9]{3}$/,
    message: 'Subdomain must be 3-20 characters, alphanumeric with hyphens'
  }
}
```

## Usage Instructions

### 1. Run Setup Script
```bash
sudo ./setup-domain-apps-only.sh yourdomain.com
```

### 2. Configure DNS
Add single wildcard A record in Namecheap:
```
Type: A Record
Host: *
Value: YOUR_SERVER_IP
```

### 3. Deploy Apps
- Create apps normally through DeployIT interface
- Apps automatically get subdomains during creation
- Subdomain URLs are displayed in dashboard and app details

## Architecture

```
yourdomain.com domain:
├── app.yourdomain.com → Your main DeployIT platform (unchanged)
├── myapp.yourdomain.com → Deployed app #1
├── blog456.yourdomain.com → Deployed app #2
└── x7k9m2.yourdomain.com → Deployed app #3
```

## Request Flow

1. **User visits**: `myapp.yourdomain.com`
2. **DNS resolves**: Wildcard A record points to server
3. **Nginx receives**: Extracts subdomain `myapp`
4. **Nginx validates**: Checks subdomain format and reserved list
5. **Nginx proxies**: `/proxy/myapp` → DeployIT platform
6. **DeployIT looks up**: App by subdomain in database
7. **DeployIT proxies**: `localhost:4001` (app's port)
8. **User sees**: The deployed app

## Environment Variables

The setup script adds these to `.env`:
```env
BASE_DOMAIN=yourdomain.com
APPS_ONLY_SUBDOMAINS=true
NODE_ENV=production
```

## Security Features

### Reserved Subdomains
Blocked from app use:
```
www, mail, ftp, ssh, admin, api, staging, dev, test, blog, shop, store, 
app, portal, dashboard, control, manage, system, root, secure, ssl, 
cdn, static, assets, media, files, docs, support, help, status, 
monitor, health
```

### Rate Limiting
- 20 requests per second per IP
- Burst of 50 requests allowed
- Applied to all app subdomains

### Validation
- Subdomain format: 3-20 characters
- Must start/end with alphanumeric
- Can contain hyphens in middle
- Database uniqueness constraint

## Error Handling

### App Not Found
- Custom HTML error page
- Clear explanation of possible causes
- Styled to match platform design

### Invalid Subdomain
- Format validation in Nginx
- Immediate rejection of invalid patterns
- Helpful error messages

### App Unavailable
- Proxy error handling
- Graceful degradation
- Retry suggestions

## Testing

### DNS Resolution
```bash
nslookup test123.yourdomain.com
```

### Nginx Configuration
```bash
sudo nginx -t
```

### App Proxy
```bash
curl -H "Host: test123.yourdomain.com" http://localhost/proxy/test123
```

## Maintenance

### Monitor Subdomains
```bash
# Check active apps
pm2 list

# Check Nginx logs
sudo tail -f /var/log/nginx/access.log | grep "yourdomain.com"

# Check proxy errors
sudo tail -f /var/log/nginx/error.log
```

### Update Reserved List
Edit `services/subdomain.js` and add to `reservedSubdomains` array.

## Benefits

1. **Clean URLs**: `myapp.yourdomain.com` instead of `yourdomain.com:4001`
2. **Professional**: Each app gets its own subdomain
3. **Scalable**: Automatic subdomain generation
4. **Secure**: Reserved subdomain protection
5. **Maintainable**: Clear separation of concerns
6. **Flexible**: Works alongside existing main site setup

## Compatibility

- **Existing apps**: Will work with port-based URLs until redeployed
- **Main site**: Completely unaffected by this implementation
- **SSL**: Works with wildcard certificates or Cloudflare
- **Development**: Graceful fallback to port-based URLs

This implementation provides a professional, scalable solution for automatic app subdomain assignment while maintaining full compatibility with existing setups. 