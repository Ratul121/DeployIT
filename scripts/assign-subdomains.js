#!/usr/bin/env node

/**
 * Script to assign subdomains to existing apps that don't have them
 * Run with: node scripts/assign-subdomains.js
 */

const mongoose = require('mongoose');
const App = require('../models/App');
const subdomainService = require('../services/subdomain');

// Load environment variables
require('dotenv').config();

async function assignSubdomainsToExistingApps() {
  try {
    console.log('🔄 Starting subdomain assignment for existing apps...');
    
    // Check if BASE_DOMAIN is configured
    if (!process.env.BASE_DOMAIN) {
      console.error('❌ BASE_DOMAIN environment variable not set');
      console.log('Please run the setup script first: sudo ./setup-domain.sh yourdomain.com');
      process.exit(1);
    }

    // Connect to database
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost/deployit';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to database');

    // Find apps without subdomains
    const appsWithoutSubdomains = await App.find({
      $or: [
        { subdomain: null },
        { subdomain: { $exists: false } }
      ]
    });

    if (appsWithoutSubdomains.length === 0) {
      console.log('✅ All apps already have subdomains assigned');
      process.exit(0);
    }

    console.log(`📋 Found ${appsWithoutSubdomains.length} apps without subdomains`);

    let successCount = 0;
    let errorCount = 0;

    // Process each app
    for (const app of appsWithoutSubdomains) {
      try {
        console.log(`\n🔄 Processing app: ${app.name} (ID: ${app._id})`);
        
        // Generate subdomain
        const subdomainResult = await subdomainService.reserveSubdomain(app.name, app.userId);
        
        // Update app with subdomain
        app.subdomain = subdomainResult.subdomain;
        
        // Update URL to use subdomain
        app.url = subdomainService.generateSubdomainUrl(subdomainResult.subdomain);
        
        await app.save();
        
        console.log(`✅ Assigned subdomain: ${subdomainResult.subdomain}`);
        console.log(`   URL: ${app.url}`);
        
        successCount++;
        
      } catch (error) {
        console.error(`❌ Error processing app ${app.name}: ${error.message}`);
        errorCount++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Successfully assigned: ${successCount} apps`);
    console.log(`   ❌ Failed: ${errorCount} apps`);
    console.log(`   📝 Total processed: ${appsWithoutSubdomains.length} apps`);

    if (successCount > 0) {
      console.log('\n🎉 Subdomain assignment completed!');
      console.log('   Apps will now be accessible via their subdomains');
      console.log(`   Base domain: ${process.env.BASE_DOMAIN}`);
      
      if (process.env.APPS_SSL_ENABLED === 'true') {
        console.log('   🔒 SSL is enabled - apps will use HTTPS');
      } else {
        console.log('   🔓 SSL is disabled - apps will use HTTP');
      }
    }

  } catch (error) {
    console.error('❌ Error during subdomain assignment:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from database');
  }
}

// Run the script
if (require.main === module) {
  assignSubdomainsToExistingApps()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = assignSubdomainsToExistingApps; 