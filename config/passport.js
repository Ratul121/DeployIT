const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const User = require('../models/User');

passport.use(new GitHubStrategy({
  clientID: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL: `${process.env.BASE_URL}/auth/github/callback`
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Only log profile in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log('GitHub Profile:', JSON.stringify(profile, null, 2));
    }
    
    // Check if user already exists
    let user = await User.findOne({ githubId: profile.id });
    
    if (user) {
      // Update existing user's access token
      user.accessToken = accessToken;
      user.lastLogin = new Date();
      await user.save();
      return done(null, user);
    }
    
    // Create new user
    user = new User({
      githubId: profile.id,
      username: profile.username,
      displayName: profile.displayName || profile.username || 'GitHub User',
      email: profile.emails && profile.emails[0] ? profile.emails[0].value : null,
      avatarUrl: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
      accessToken: accessToken,
      profileUrl: profile.profileUrl,
      createdAt: new Date(),
      lastLogin: new Date()
    });
    
    await user.save();
    return done(null, user);
  } catch (error) {
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport; 