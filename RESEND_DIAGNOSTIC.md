# Resend Email Diagnostic Guide

## Purpose

This guide helps you verify that Resend is properly configured and successfully sending welcome emails. The welcome email is sent via the Resend API (not Supabase), so issues here are independent from Supabase auth emails.

## Step 1: Access Resend Dashboard

1. Go to [Resend Dashboard](https://resend.com)
2. Log in to your account
3. Navigate to **Logs** (in left sidebar)

## Step 2: Check Recent Email Send Attempts

### After a Trial Checkout:

Look for email send attempts to your customer's email address.

### What to Look For:

#### ✅ Success Pattern:
```
To: customer@example.com
From: Sam from QuoteTree <sam@quotetree.ai>
Subject: Welcome to QuoteTree 🙌
Status: Delivered
Time: [timestamp after checkout]
```

#### ❌ No API Calls Showing Up:

**This means the API call never reached Resend.**

**Possible Causes:**
1. `RESEND_API_KEY` not set in Vercel
2. `RESEND_API_KEY` incorrect or invalid
3. Webhook code error preventing email sending
4. Error caught and suppressed in webhook

**How to Diagnose:**
- Check Vercel function logs for:
  ```
  ⚠️ Welcome email failed (non-critical): [error details]
  ```
- Look for specific error about Resend or API key

**Solution:**
1. Verify `RESEND_API_KEY` in Vercel Production environment
2. Make sure it starts with `re_` (live mode)
3. Test the API key (see Step 4 below)
4. Redeploy after fixing

#### ❌ API Call Failed (4xx or 5xx status):

Click on the failed send attempt to see details.

**Common Errors:**

**401 Unauthorized:**
```
Error: Invalid API key
Status: 401
```
- Problem: API key is wrong or revoked
- Solution:
  1. Go to [Resend API Keys](https://resend.com/api-keys)
  2. Generate new key or verify existing
  3. Update `RESEND_API_KEY` in Vercel
  4. **MUST redeploy**

**403 Forbidden - Domain Not Verified:**
```
Error: Domain not verified
Status: 403
```
- Problem: Sender email domain not verified
- Current sender: `sam@quotetree.ai`
- Solution: Verify `quotetree.ai` domain (see Step 5)

**400 Bad Request:**
```
Error: Invalid email address
Status: 400
```
- Problem: Email address format invalid
- Check webhook is passing correct email

**429 Rate Limit:**
```
Error: Too many requests
Status: 429
```
- Problem: API rate limit exceeded
- Check your Resend plan limits
- May need to upgrade

## Step 3: Verify API Key Configuration

### Check Current API Keys:

1. Go to [Resend API Keys](https://resend.com/api-keys)
2. View your active API keys

### Key Requirements:

#### For Production (Live Mode):
- ✅ Key should start with `re_`
- ✅ Key should be marked as "Production" or "Live"
- ✅ Key should have send permissions
- ❌ Should NOT be a test/development key

#### Test vs Production Keys:

**If using wrong key type:**
- Test keys may have different sending behavior
- Production requires verified domain
- Check the key description/name in Resend dashboard

### If You Need a New Key:

1. Click **+ Create API Key**
2. Name it: "Production - QuoteTree App"
3. Select permissions: **Full Access** or **Send emails**
4. Click **Create**
5. **Copy the key immediately** (only shown once)
6. Add to Vercel:
   - Settings → Environment Variables
   - `RESEND_API_KEY` = `re_...`
   - Environment: **Production**
7. **MUST redeploy**

## Step 4: Test API Key Directly

To verify the API key works independently from your webhook:

### Using curl:

```bash
curl -X POST https://api.resend.com/emails \
  -H 'Authorization: Bearer re_your_api_key_here' \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "onboarding@resend.dev",
    "to": "your-test-email@example.com",
    "subject": "API Key Test",
    "html": "<p>If you receive this, your API key works!</p>"
  }'
```

### Expected Response:

**Success (200):**
```json
{
  "id": "abc123",
  "from": "onboarding@resend.dev",
  "to": "your-test-email@example.com",
  "created_at": "2024-01-01T12:00:00.000Z"
}
```

**Failure (401):**
```json
{
  "error": {
    "message": "Invalid API key"
  }
}
```

### If Direct Test Works:

✅ API key is valid!
- Problem is in webhook code or environment variables
- Check Vercel logs for actual error
- Verify `RESEND_API_KEY` is set correctly in Vercel Production

### If Direct Test Fails:

❌ API key is invalid
- Generate new API key
- Update in Vercel
- Redeploy

## Step 5: Check Domain Verification

### Why Domain Verification Matters:

Resend requires verified domains for production sending:
- Prevents spam
- Improves deliverability
- Required for custom sender addresses

### Current Sender Address:

Your app uses: `sam@quotetree.ai`

This requires `quotetree.ai` to be verified in Resend.

### Check Domain Status:

1. Go to [Resend Domains](https://resend.com/domains)
2. Look for `quotetree.ai`

#### ✅ If Domain is Verified:
```
Domain: quotetree.ai
Status: ✓ Verified
DNS Records: All configured
```
- Domain is good to go!
- If emails still failing, check other issues

#### ❌ If Domain NOT Listed:
- You need to add and verify the domain
- See: "How to Verify Domain" below

#### ⚠️ If Domain is Pending:
```
Domain: quotetree.ai
Status: ⏳ Pending verification
DNS Records: Waiting for propagation
```
- DNS records need to propagate (can take 1-48 hours)
- Check DNS record configuration
- See: "How to Verify Domain" below

### How to Verify Domain:

#### Step 1: Add Domain

1. [Resend Domains](https://resend.com/domains) → **Add Domain**
2. Enter: `quotetree.ai`
3. Click **Add**

#### Step 2: Get DNS Records

Resend will provide DNS records to add:

1. **SPF Record:**
   ```
   Type: TXT
   Name: @
   Value: v=spf1 include:_spf.resend.com ~all
   ```

2. **DKIM Records (2-3 records):**
   ```
   Type: TXT
   Name: resend._domainkey
   Value: [long string provided by Resend]
   ```

3. **DMARC Record (optional but recommended):**
   ```
   Type: TXT
   Name: _dmarc
   Value: v=DMARC1; p=none; rua=mailto:dmarc@quotetree.ai
   ```

#### Step 3: Add DNS Records

1. Go to your DNS provider (where you registered quotetree.ai)
   - Could be: Namecheap, GoDaddy, Cloudflare, etc.
2. Find DNS settings / DNS management
3. Add each TXT record provided by Resend
4. Save changes

#### Step 4: Wait for Propagation

- DNS changes can take 1-48 hours
- Usually happens within 15-60 minutes
- You can check status in Resend dashboard

#### Step 5: Verify in Resend

1. Resend will automatically check DNS records
2. Once detected, status changes to "Verified"
3. You can now send from `@quotetree.ai` addresses

### Check DNS Records Manually:

Use online tools to verify DNS records are set correctly:

```bash
# Check SPF record
dig TXT quotetree.ai

# Check DKIM record
dig TXT resend._domainkey.quotetree.ai
```

Or use: https://mxtoolbox.com/

## Step 6: Check Email Content

If emails are sending but users report issues:

### Click on a Sent Email:

In Resend logs, click on a sent email to see details:

1. **Email preview** - How it looked
2. **HTML source** - The actual code
3. **Delivery status** - Sent/Delivered/Bounced
4. **Opens/Clicks** - Engagement metrics

### Common Issues:

**Issue: Emails Going to Spam**
- Check SPF/DKIM records are verified
- Check email content (avoid spam triggers)
- Use verified sender domain

**Issue: Links Not Working**
- Check `NEXT_PUBLIC_APP_URL` is correct
- Test links in email preview

**Issue: Formatting Broken**
- Check HTML in email template
- Test in different email clients

## Step 7: Monitor Sending Metrics

### Resend Dashboard Metrics:

1. Go to [Resend Home](https://resend.com)
2. View sending statistics:
   - Total emails sent
   - Delivery rate
   - Bounce rate
   - Spam complaint rate

### Healthy Metrics:

- ✅ Delivery rate: > 95%
- ✅ Bounce rate: < 5%
- ✅ Spam complaints: < 0.1%

### Unhealthy Metrics:

- ❌ Low delivery rate → Domain reputation issue
- ❌ High bounce rate → Invalid email addresses
- ❌ High spam rate → Content issues or no domain verification

## Common Issues & Solutions

### Issue 1: No API Calls in Resend Logs

**Symptoms:**
- Resend logs show no attempts
- Webhook completes but no email sent

**Diagnosis:**
Check Vercel logs for:
```
⚠️ Welcome email failed (non-critical): [error]
```

**Common Causes:**
1. `RESEND_API_KEY` not set
2. Code error before email sending
3. Error caught and suppressed

**Solution:**
1. Check Vercel function logs for actual error
2. Verify `RESEND_API_KEY` in Vercel Production
3. Verify it starts with `re_`
4. Redeploy after fixing

### Issue 2: Domain Not Verified Error

**Symptoms:**
- Resend shows 403 error
- "Domain not verified" message

**Solution:**
1. Add `quotetree.ai` domain in Resend
2. Configure DNS records (SPF, DKIM, DMARC)
3. Wait for verification (15min - 48hrs)
4. Test again

### Issue 3: Invalid API Key

**Symptoms:**
- Resend shows 401 error
- "Invalid API key" or "Unauthorized"

**Solution:**
1. Generate new API key in Resend
2. Make sure it starts with `re_`
3. Update `RESEND_API_KEY` in Vercel Production
4. **MUST redeploy**
5. Test again

### Issue 4: Emails Delivered But Not Received

**Symptoms:**
- Resend shows "Delivered"
- Customer doesn't receive email

**Possible Causes:**
- Email went to spam
- Corporate email filter blocked it
- Email client issue

**Solution:**
1. Ask customer to check spam folder
2. Verify domain DNS records (SPF, DKIM)
3. Check sender reputation
4. Use "Send Test Email" in Resend to your own email first

## Testing Checklist

- [ ] Resend API key is set in Vercel Production
- [ ] API key starts with `re_` (live mode)
- [ ] Domain `quotetree.ai` is added in Resend
- [ ] Domain is verified (DNS records configured)
- [ ] SPF record is set
- [ ] DKIM records are set
- [ ] API key works (test with curl or Resend console)
- [ ] Sender address matches verified domain
- [ ] Recent logs show successful sends (not 401/403)
- [ ] Delivery rate is high (> 95%)

## Next Steps

### If Resend Logs Show Success:
✅ Welcome email is being sent!
- If customer doesn't receive: check spam folder
- Check email client/provider blocking
- Consider email content adjustments

### If Resend Shows No API Calls:
❌ Email code not executing:
- Check Vercel logs for errors
- Verify `RESEND_API_KEY` is set
- Check webhook code is working

### If Resend Shows Errors:
❌ Fix the specific error:
- 401: Invalid API key
- 403: Domain not verified
- 400: Invalid request format
- 429: Rate limit (upgrade plan)

### Continue Troubleshooting:
See `LIVE_MODE_EMAIL_TROUBLESHOOTING.md` for complete diagnostic flow.

