#!/usr/bin/env node

/**
 * Environment Configuration Checker
 * 
 * This script helps diagnose email issues by checking which environment
 * variables are properly configured. Run this locally to verify your setup.
 * 
 * Usage:
 *   node scripts/check-env-config.js
 */

const requiredEnvVars = {
  // Supabase
  'NEXT_PUBLIC_SUPABASE_URL': {
    required: true,
    description: 'Supabase project URL',
    example: 'https://your-project.supabase.co',
    shouldStartWith: 'https://',
    shouldEndWith: '.supabase.co',
  },
  'NEXT_PUBLIC_SUPABASE_ANON_KEY': {
    required: true,
    description: 'Supabase anonymous key',
    example: 'eyJ...',
    shouldStartWith: 'eyJ',
  },
  'SUPABASE_SERVICE_ROLE_KEY': {
    required: true,
    description: 'Supabase service role key (for webhooks)',
    example: 'eyJ...',
    shouldStartWith: 'eyJ',
  },
  
  // Resend
  'RESEND_API_KEY': {
    required: true,
    description: 'Resend API key for sending emails',
    example: 're_...',
    shouldStartWith: 're_',
    note: 'MUST start with re_ for live mode (not test key)',
  },
  
  // App URL
  'NEXT_PUBLIC_APP_URL': {
    required: true,
    description: 'Your production app URL',
    example: 'https://quotetree.ai',
    shouldStartWith: 'https://',
    note: 'Should be your production domain, not localhost',
  },
  
  // Stripe
  'STRIPE_SECRET_KEY': {
    required: true,
    description: 'Stripe secret key',
    example: 'sk_live_... or sk_test_...',
    shouldStartWith: 'sk_',
    note: 'For production, should start with sk_live_',
  },
  'STRIPE_WEBHOOK_SECRET': {
    required: true,
    description: 'Stripe webhook signing secret',
    example: 'whsec_...',
    shouldStartWith: 'whsec_',
  },
};

function checkEnvironmentVariables() {
  console.log('\n🔍 Checking Environment Configuration...\n');
  console.log('=' .repeat(70));
  
  let hasErrors = false;
  let hasWarnings = false;
  const results = [];
  
  for (const [varName, config] of Object.entries(requiredEnvVars)) {
    const value = process.env[varName];
    const result = {
      name: varName,
      set: !!value,
      valid: false,
      issues: [],
    };
    
    // Check if variable is set
    if (!value) {
      result.issues.push('❌ NOT SET');
      hasErrors = true;
    } else {
      // Check format
      if (config.shouldStartWith && !value.startsWith(config.shouldStartWith)) {
        result.issues.push(`⚠️  Should start with "${config.shouldStartWith}"`);
        hasWarnings = true;
      }
      
      if (config.shouldEndWith && !value.endsWith(config.shouldEndWith)) {
        result.issues.push(`⚠️  Should end with "${config.shouldEndWith}"`);
        hasWarnings = true;
      }
      
      // Stripe-specific checks
      if (varName === 'STRIPE_SECRET_KEY') {
        if (value.startsWith('sk_test_')) {
          result.issues.push('⚠️  Using TEST mode key (sk_test_) - should be LIVE (sk_live_) for production');
          hasWarnings = true;
        } else if (value.startsWith('sk_live_')) {
          result.issues.push('✅ Using LIVE mode key');
        }
      }
      
      // App URL checks
      if (varName === 'NEXT_PUBLIC_APP_URL') {
        if (value.includes('localhost') || value.includes('127.0.0.1')) {
          result.issues.push('⚠️  Using localhost - should be production domain for live mode');
          hasWarnings = true;
        } else if (value.includes('vercel.app')) {
          result.issues.push('⚠️  Using Vercel preview URL - should be custom domain');
          hasWarnings = true;
        }
      }
      
      if (result.issues.length === 0) {
        result.issues.push('✅ Configured correctly');
        result.valid = true;
      }
    }
    
    results.push(result);
  }
  
  // Display results
  for (const result of results) {
    const config = requiredEnvVars[result.name];
    console.log(`\n${result.name}`);
    console.log(`  Description: ${config.description}`);
    console.log(`  Example: ${config.example}`);
    
    if (result.set) {
      const maskedValue = process.env[result.name].substring(0, 10) + '...';
      console.log(`  Current: ${maskedValue}`);
    }
    
    for (const issue of result.issues) {
      console.log(`  ${issue}`);
    }
    
    if (config.note) {
      console.log(`  📝 Note: ${config.note}`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('\n📊 Summary:\n');
  
  const setCount = results.filter(r => r.set).length;
  const validCount = results.filter(r => r.valid).length;
  
  console.log(`✅ Variables set: ${setCount}/${results.length}`);
  console.log(`✅ Correctly configured: ${validCount}/${results.length}`);
  
  if (hasErrors) {
    console.log('\n❌ ERRORS FOUND: Some required variables are missing!');
    console.log('   → Fix these in your Vercel Dashboard → Settings → Environment Variables');
    console.log('   → Make sure to set them for the PRODUCTION environment');
    console.log('   → After updating, you MUST redeploy your application');
  }
  
  if (hasWarnings) {
    console.log('\n⚠️  WARNINGS: Some variables may not be configured correctly for production');
    console.log('   → Review the warnings above');
    console.log('   → Update as needed in Vercel Dashboard');
  }
  
  if (!hasErrors && !hasWarnings) {
    console.log('\n🎉 All environment variables are configured correctly!');
    console.log('\n   If emails still aren\'t working, check:');
    console.log('   1. Vercel function logs for actual errors');
    console.log('   2. Stripe webhook logs (should show 200 responses)');
    console.log('   3. Supabase auth logs for email send attempts');
    console.log('   4. Resend dashboard logs for delivery status');
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('\n💡 Next Steps:\n');
  console.log('1. Follow the LIVE_MODE_EMAIL_TROUBLESHOOTING.md guide');
  console.log('2. Check Vercel production logs for actual webhook execution');
  console.log('3. Verify Stripe webhook is receiving events and returning 200');
  console.log('4. Check Resend dashboard to verify domain is verified');
  console.log('\n');
  
  process.exit(hasErrors ? 1 : 0);
}

// Run the check
checkEnvironmentVariables();

