# GitHub App Deployment Platform

A Node.js web application that enables users to connect their GitHub accounts and deploy repositories with a streamlined dashboard interface. The platform provides OAuth authentication, repository management, and automated deployment with real-time logging capabilities.

## Features

- **GitHub OAuth Integration**: Seamless authentication with GitHub accounts
- **Repository Management**: Browse and select from your GitHub repositories
- **One-Click Deployment**: Deploy applications with automated setup
- **Real-time Monitoring**: Live deployment logs and status updates
- **PM2 Integration**: Process management for deployed applications
- **Beautiful UI**: Modern, responsive interface built with Tailwind CSS

## Tech Stack

- **Backend**: Node.js with Express.js
- **Database**: MongoDB with Mongoose
- **Authentication**: GitHub OAuth via Passport.js
- **Process Management**: PM2
- **Real-time Communication**: Socket.io
- **Frontend**: EJS templating with Tailwind CSS
- **Security**: Helmet, rate limiting, input validation

## Prerequisites

- Node.js (v16 or higher)
- MongoDB (local or cloud instance)
- PM2 installed globally (`npm install -g pm2`)
- Git
- GitHub OAuth App credentials

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd github-deployment-platform
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your configuration:
   ```env
   # GitHub OAuth Configuration
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   
   # Session Configuration
   SESSION_SECRET=your_session_secret_key
   
   # Database Configuration
   DATABASE_URL=mongodb://localhost:27017/github-deployment-platform
   
   # Application Configuration
   PORT=3000
   BASE_URL=http://localhost:3000
   
   # Apps Base URL (for deployed apps)
   # Local development: http://localhost
   # Production: https://yourdomain.com or http://your-server-ip
   APPS_BASE_URL=http://localhost
   
   # PM2 Configuration
   PM2_PORT_START=4000
   PM2_PORT_END=5000
   ```

4. **Set up GitHub OAuth App**
   - Go to GitHub Settings > Developer settings > OAuth Apps
   - Create a new OAuth App
   - Set Authorization callback URL to: `http://localhost:3000/auth/github/callback`
   - Copy Client ID and Client Secret to your `.env` file

5. **Start MongoDB**
   ```bash
   # If using local MongoDB
   mongod
   ```

6. **Start the application**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

## Usage

1. **Access the application**
   - Open your browser and go to `http://localhost:3000`

2. **Connect GitHub account**
   - Click "Connect GitHub" to authenticate with your GitHub account

3. **Create a new app**
   - Click "New App" in the dashboard
   - Select a repository from your GitHub account
   - Configure deployment settings (startup command, environment variables, etc.)
   - Click "Create Application"

4. **Deploy your app**
   - Go to the app details page
   - Click "Deploy" to start the deployment process
   - Monitor real-time logs during deployment

5. **Manage your apps**
   - View all your apps in the dashboard
   - Start, stop, restart, or delete applications
   - Monitor deployment history and logs

## Project Structure

```
github-deployment-platform/
├── config/
│   └── passport.js          # Passport.js configuration
├── models/
│   ├── User.js              # User model
│   ├── App.js               # Application model
│   └── Deployment.js        # Deployment model
├── routes/
│   ├── auth.js              # Authentication routes
│   ├── dashboard.js         # Dashboard routes
│   ├── apps.js              # App management routes
│   └── repos.js             # Repository routes
├── services/
│   ├── database.js          # Database connection service
│   ├── socket.js            # Socket.io service
│   ├── github.js            # GitHub API service
│   └── deployment.js        # Deployment service
├── middleware/
│   └── auth.js              # Authentication middleware
├── views/
│   ├── apps/
│   │   ├── new.ejs          # New app creation page
│   │   └── details.ejs      # App details page
│   ├── index.ejs            # Homepage
│   ├── dashboard.ejs        # Dashboard page
│   ├── error.ejs            # Error page
│   └── 404.ejs              # 404 page
├── deployments/             # Deployment files (created at runtime)
├── server.js                # Main application file
├── package.json             # Dependencies and scripts
└── README.md               # This file
```

## API Endpoints

### Authentication
- `GET /auth/github` - Initiate GitHub OAuth
- `GET /auth/github/callback` - OAuth callback
- `POST /auth/logout` - Logout user

### Dashboard
- `GET /dashboard` - Main dashboard

### Apps
- `GET /apps` - List user's apps (API)
- `POST /apps` - Create new app
- `GET /apps/:id` - App details page
- `POST /apps/:id/deploy` - Deploy app
- `POST /apps/:id/restart` - Restart app
- `POST /apps/:id/stop` - Stop app
- `DELETE /apps/:id` - Delete app
- `GET /apps/:id/logs` - Get app logs

### Repositories
- `GET /repos` - List user's repositories
- `GET /repos/:owner/:repo` - Get repository details
- `GET /repos/:owner/:repo/branches` - Get repository branches

## Security Features

- **Helmet**: Security headers
- **Rate Limiting**: Prevents abuse
- **Input Validation**: Validates all user inputs
- **Session Security**: Secure session management
- **OAuth Security**: Secure GitHub authentication
- **CSRF Protection**: Cross-site request forgery protection

## Development

### Running in Development Mode
```bash
npm run dev
```

### Environment Variables
- `NODE_ENV`: Set to `development` for development mode
- `PORT`: Server port (default: 3000)
- `BASE_URL`: Main application URL (default: http://localhost:3000)
- `APPS_BASE_URL`: Base URL for deployed apps (default: http://localhost)
- `DATABASE_URL`: MongoDB connection string
- `GITHUB_CLIENT_ID`: GitHub OAuth client ID
- `GITHUB_CLIENT_SECRET`: GitHub OAuth client secret
- `SESSION_SECRET`: Session encryption secret
- `PM2_PORT_START`: Starting port for deployed apps (default: 4000)
- `PM2_PORT_END`: Ending port for deployed apps (default: 5000)

### Adding New Features
1. Create models in `models/` directory
2. Add routes in `routes/` directory
3. Create services in `services/` directory
4. Add views in `views/` directory
5. Update middleware as needed

## Deployment

### Production Deployment
1. Set `NODE_ENV=production` in your environment
2. Use a production MongoDB instance
3. Configure proper SSL certificates
4. Set up a reverse proxy (nginx recommended)
5. Use PM2 for process management

### Docker Deployment
```bash
# Build Docker image
docker build -t github-deployment-platform .

# Run container
docker run -p 3000:3000 --env-file .env github-deployment-platform
```

## Troubleshooting

### Common Issues

1. **MongoDB Connection Error**
   - Ensure MongoDB is running
   - Check DATABASE_URL in .env file
   - Verify MongoDB credentials

2. **GitHub OAuth Error**
   - Verify GitHub OAuth app settings
   - Check callback URL matches your configuration
   - Ensure CLIENT_ID and CLIENT_SECRET are correct

3. **PM2 Connection Error**
   - Install PM2 globally: `npm install -g pm2`
   - Start PM2 daemon: `pm2 start`

4. **Port Already in Use**
   - Change PORT in .env file
   - Kill process using the port: `lsof -ti:3000 | xargs kill`

### Logs
- Application logs: Check console output
- PM2 logs: `pm2 logs`
- MongoDB logs: Check MongoDB log files

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, please open an issue in the GitHub repository or contact the development team. 