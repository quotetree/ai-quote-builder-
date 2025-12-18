/**
 * Stripe Environment Guards
 * 
 * Validates that Stripe is properly configured for the current environment.
 * Prevents accidental use of test mode keys in production.
 */

/**
 * Detect if the application is running in production
 * Checks both NODE_ENV and VERCEL_ENV
 */
export function isProduction(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}

/**
 * Validate Stripe Secret Key format and environment appropriateness
 * @param key - The STRIPE_SECRET_KEY value
 * @throws Error if key is invalid or doesn't match environment
 */
export function validateStripeSecretKey(key: string | undefined): void {
  const isProd = isProduction();

  // Key is required in all environments
  if (!key) {
    throw new Error(
      `❌ STRIPE_SECRET_KEY is required but not set. ` +
      `Environment: ${isProd ? "PRODUCTION" : "DEVELOPMENT"}`
    );
  }

  // Check key format
  const isTestKey = key.startsWith("sk_test_");
  const isLiveKey = key.startsWith("sk_live_");

  if (!isTestKey && !isLiveKey) {
    throw new Error(
      `❌ STRIPE_SECRET_KEY has invalid format. ` +
      `Expected to start with "sk_test_" or "sk_live_", got: "${key.substring(0, 10)}..."`
    );
  }

  // Production environment MUST use live keys
  if (isProd && isTestKey) {
    throw new Error(
      `❌ SECURITY ERROR: Cannot use Stripe TEST key in PRODUCTION environment!\n` +
      `   Current key starts with: "sk_test_..."\n` +
      `   Required: "sk_live_..."\n` +
      `   Set STRIPE_SECRET_KEY to your live mode secret key.`
    );
  }

  // Development environment: warn if using live key (but allow it)
  if (!isProd && isLiveKey) {
    console.warn(
      `⚠️  WARNING: Using Stripe LIVE key in DEVELOPMENT environment.\n` +
      `   Current key: "sk_live_..."\n` +
      `   Consider using: "sk_test_..."\n` +
      `   This will charge real credit cards!`
    );
  }

  // Success messages
  if (isProd && isLiveKey) {
    console.log(`✅ Stripe configured in LIVE mode for PRODUCTION`);
  } else if (!isProd && isTestKey) {
    console.log(`✅ Stripe configured in TEST mode for DEVELOPMENT`);
  }
}

/**
 * Validate Stripe Publishable Key format and environment appropriateness
 * @param key - The NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY value
 * @throws Error if key is invalid or doesn't match environment
 */
export function validateStripePublishableKey(key: string | undefined): void {
  const isProd = isProduction();

  // Key is required in all environments
  if (!key) {
    throw new Error(
      `❌ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required but not set. ` +
      `Environment: ${isProd ? "PRODUCTION" : "DEVELOPMENT"}`
    );
  }

  // Check key format
  const isTestKey = key.startsWith("pk_test_");
  const isLiveKey = key.startsWith("pk_live_");

  if (!isTestKey && !isLiveKey) {
    throw new Error(
      `❌ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY has invalid format. ` +
      `Expected to start with "pk_test_" or "pk_live_", got: "${key.substring(0, 10)}..."`
    );
  }

  // Production environment MUST use live keys
  if (isProd && isTestKey) {
    throw new Error(
      `❌ SECURITY ERROR: Cannot use Stripe TEST publishable key in PRODUCTION!\n` +
      `   Current key starts with: "pk_test_..."\n` +
      `   Required: "pk_live_..."\n` +
      `   Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to your live mode publishable key.`
    );
  }

  // Development environment: warn if using live key (but allow it)
  if (!isProd && isLiveKey) {
    console.warn(
      `⚠️  WARNING: Using Stripe LIVE publishable key in DEVELOPMENT.\n` +
      `   Current key: "pk_live_..."\n` +
      `   Consider using: "pk_test_..."\n` +
      `   This will charge real credit cards!`
    );
  }

  // Success messages
  if (isProd && isLiveKey) {
    console.log(`✅ Stripe publishable key configured in LIVE mode for PRODUCTION`);
  } else if (!isProd && isTestKey) {
    console.log(`✅ Stripe publishable key configured in TEST mode for DEVELOPMENT`);
  }
}

/**
 * Validate that webhook secret exists and matches key mode
 * @param webhookSecret - The STRIPE_WEBHOOK_SECRET value
 * @param secretKey - The STRIPE_SECRET_KEY value (for mode matching)
 */
export function validateWebhookSecret(
  webhookSecret: string | undefined,
  secretKey: string | undefined
): void {
  const isProd = isProduction();

  if (!webhookSecret) {
    throw new Error(
      `❌ STRIPE_WEBHOOK_SECRET is required but not set. ` +
      `Environment: ${isProd ? "PRODUCTION" : "DEVELOPMENT"}`
    );
  }

  if (!webhookSecret.startsWith("whsec_")) {
    throw new Error(
      `❌ STRIPE_WEBHOOK_SECRET has invalid format. ` +
      `Expected to start with "whsec_", got: "${webhookSecret.substring(0, 10)}..."`
    );
  }

  // Warn if secret key and webhook might be mismatched
  // (We can't definitively tell test vs live webhook secrets, but we can check key consistency)
  if (secretKey) {
    const isLiveKey = secretKey.startsWith("sk_live_");
    if (isProd && !isLiveKey) {
      console.warn(
        `⚠️  WARNING: Webhook secret detected but secret key appears to be in test mode.\n` +
        `   Ensure your webhook secret is from the LIVE mode Stripe dashboard.`
      );
    }
  }

  console.log(`✅ Webhook secret configured for ${isProd ? "PRODUCTION" : "DEVELOPMENT"}`);
}

/**
 * Assert that all Stripe configuration is ready for production
 * Call this at application startup or in critical paths
 */
export function assertProductionReady(): void {
  if (!isProduction()) {
    // In development, we're more lenient
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Validate all keys
  validateStripeSecretKey(secretKey);
  validateStripePublishableKey(publishableKey);
  validateWebhookSecret(webhookSecret, secretKey);

  console.log(`✅ All Stripe configuration validated for PRODUCTION deployment`);
}

