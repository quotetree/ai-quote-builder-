# Resend SMTP Setup for Supabase Auth

## When to Use Custom SMTP

Configure custom SMTP with Resend if you're experiencing:
- ✅ Password reset emails going to spam
- ✅ Supabase rate limits on emails
- ✅ Poor email deliverability
- ✅ Emails not arriving at all with default Supabase SMTP

## Benefits of Custom SMTP

- **Better Deliverability:** Higher inbox placement rate
- **No Rate Limits:** Bypass Supabase's email rate limits
- **Custom Domain:** Send from your verified domain
- **Consistent Provider:** Same as your welcome emails (Resend)
- **Better Monitoring:** Track all emails in one place (Resend dashboard)

## Prerequisites

Before you start:
- [ ] Resend account created
- [ ] Domain `quotetree.ai` added and verified in Resend
- [ ] DNS records (SPF, DKIM) configured
- [ ] Access to Supabase production project dashboard

## Step 1: Get Resend SMTP Credentials

### Important: Use SMTP Credentials, NOT API Key

Supabase SMTP requires username/password credentials, **NOT** your Resend API key.

### Get SMTP Credentials from Resend:

1. Go to [Resend Dashboard](https://resend.com)
2. Navigate to **API Keys** → **SMTP**
3. You'll see SMTP connection details:

```
Host: smtp.resend.com
Port: 465 (SSL) or 587 (TLS)
Username: resend
Password: [a generated password/token]
```

### Notes:
- The username is typically `resend`
- The password is a generated credential (looks like an API key)
- **This is different from your regular API key**
- If you don't see SMTP credentials, you may need to generate them

### If SMTP Section Doesn't Exist:

Some Resend accounts show SMTP credentials differently:

**Option A: Use API Key as Password**
- Username: `resend`
- Password: Your Resend API key (starts with `re_`)

**Option B: Generate SMTP Credentials**
- Look for "Generate SMTP Credentials" button
- Create new SMTP credentials specifically for Supabase

## Step 2: Configure SMTP in Supabase

### Navigate to SMTP Settings:

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your **production project**
3. Go to **Settings** → **Auth**
4. Scroll down to **SMTP Settings**

### Enable Custom SMTP:

1. Toggle **Enable Custom SMTP** to ON
2. Fill in the SMTP configuration:

```
SMTP Host: smtp.resend.com
SMTP Port: 465
SMTP User: resend
SMTP Pass: [Your SMTP password from Resend]
Sender Email: noreply@quotetree.ai
Sender Name: QuoteTree
```

### Field Details:

#### SMTP Host:
- **Value:** `smtp.resend.com`
- ✅ No `https://` prefix
- ✅ Just the hostname

#### SMTP Port:
- **Option 1 (Recommended):** `465` (SSL)
- **Option 2:** `587` (TLS)
- Both work, 465 is slightly more secure

#### SMTP User:
- **Value:** `resend`
- This is typically the same for all Resend SMTP connections

#### SMTP Pass:
- **Value:** Your SMTP password from Resend dashboard
- ⚠️ This is NOT your API key (unless using Option A above)
- Should be a long string/token

#### Sender Email:
- **Value:** `noreply@quotetree.ai`
- ✅ **MUST use a verified domain**
- ❌ Cannot use `@resend.dev` in production
- ❌ Cannot use unverified domain

#### Sender Name:
- **Value:** `QuoteTree`
- This appears as the "from" name in emails
- Can be anything you want

### Save Configuration:

1. Click **Save**
2. Supabase will validate the configuration
3. If successful, you'll see a success message

### Common Configuration Errors:

**Error: "Invalid SMTP credentials"**
- Double-check username and password
- Make sure password is the SMTP password, not API key
- Try regenerating SMTP credentials

**Error: "Cannot connect to SMTP server"**
- Check host is `smtp.resend.com` (no typos)
- Try different port (465 vs 587)
- Check Resend service status

**Error: "Sender email not verified"**
- Domain must be verified in Resend
- Go to Resend → Domains
- Verify `quotetree.ai` is marked as verified
- See: `RESEND_DIAGNOSTIC.md` Step 5

## Step 3: Test SMTP Configuration

### Test via Supabase:

Supabase usually has a "Send test email" button in SMTP settings.

1. Enter your email address
2. Click "Send test email"
3. Check your inbox (and spam)

### Test via Password Reset:

1. Go to your app: `https://quotetree.ai/auth/forgot-password`
2. Enter an email address
3. Request password reset
4. Check Supabase Auth logs
5. Check email inbox

### Expected Results:

**In Supabase Auth Logs:**
```
recovery.requested → recovery.sent (via custom SMTP)
```

**In Email Inbox:**
- Email from: `QuoteTree <noreply@quotetree.ai>`
- Subject: Password reset email
- Arrives within 1-2 minutes
- NOT in spam folder

## Step 4: Verify in Resend Dashboard

After sending test email:

1. Go to [Resend Logs](https://resend.com/logs)
2. Look for recent email send
3. Should show email sent via SMTP (not API)

### Resend Log Entry:

```
From: noreply@quotetree.ai
To: test@example.com
Subject: Reset Your Password
Status: Delivered
Method: SMTP
```

Note: SMTP emails may appear slightly differently in logs than API emails.

## Step 5: Update Email Templates (Optional)

### Customize Supabase Email Templates:

1. Supabase Dashboard → **Authentication** → **Email Templates**
2. Select **Reset Password** template
3. Customize design/content if desired
4. Make sure template includes `{{ .ConfirmationURL }}`

### Match Your Brand:

You can update the template to match your welcome email design:
- Similar colors
- Same logo
- Consistent tone
- Same sender name/email

## Troubleshooting

### SMTP Not Working After Setup

#### Check 1: Verify Configuration

- Host: `smtp.resend.com` (no typos)
- Port: `465` or `587`
- Username: Correct (usually `resend`)
- Password: SMTP password (not API key)

#### Check 2: Verify Domain in Resend

1. Resend Dashboard → Domains
2. `quotetree.ai` should show: ✓ Verified
3. Check DNS records are all green checkmarks

#### Check 3: Test SMTP Credentials Manually

Use a tool like [SMTP Tester](https://www.smtper.net/) or test with code:

```javascript
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransporter({
  host: 'smtp.resend.com',
  port: 465,
  secure: true,
  auth: {
    user: 'resend',
    pass: 'your_smtp_password_here'
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.log('SMTP Error:', error);
  } else {
    console.log('SMTP Ready!');
  }
});
```

#### Check 4: Check Supabase Logs

- Go to Supabase → Authentication → Logs
- Look for SMTP errors
- Common errors:
  - Authentication failed
  - Connection timeout
  - Invalid sender domain

### Emails Still Going to Spam

Even with custom SMTP, emails might go to spam if:

**Issue:** Domain reputation is new
- **Solution:** It takes time to build sender reputation
- Send consistent volume
- Maintain low bounce/spam complaint rates

**Issue:** Missing DNS records
- **Solution:** Verify SPF, DKIM, and DMARC records
- Use [MXToolbox](https://mxtoolbox.com/) to check

**Issue:** Email content triggers spam filters
- **Solution:** Review email template
- Avoid spam trigger words
- Include plain text version
- Don't use all caps or excessive punctuation

### Sender Email Rejected

**Error: "Sender email not verified"**

1. Go to Resend Dashboard → Domains
2. Check `quotetree.ai` status
3. If not verified:
   - Check DNS records
   - Wait for propagation (up to 48 hours)
   - Try manual verification in Resend

**Error: "Invalid sender"**

- Make sure sender email uses verified domain
- Format: `name@quotetree.ai`
- Cannot use: `@gmail.com`, `@yahoo.com`, etc.

## Monitoring & Maintenance

### Regular Checks:

- **Weekly:** Check Resend dashboard for delivery rates
- **Weekly:** Check Supabase auth logs for email errors
- **Monthly:** Review spam complaint rates
- **Monthly:** Check DNS records still valid

### Metrics to Monitor:

In Resend Dashboard:
- ✅ Delivery rate > 95%
- ✅ Bounce rate < 5%
- ✅ Spam complaints < 0.1%

In Supabase:
- ✅ No authentication email errors
- ✅ No rate limit errors
- ✅ Fast email sending (< 1 second)

## Rollback to Default SMTP

If you need to revert to Supabase default SMTP:

1. Supabase Dashboard → Settings → Auth
2. Find SMTP Settings
3. Toggle **Enable Custom SMTP** to OFF
4. Click **Save**

Note: You'll lose custom sender domain but may have more reliable sending for development.

## Benefits After Setup

Once SMTP is configured correctly:

✅ **Better Deliverability:**
- Emails land in inbox, not spam
- Higher open rates
- Faster delivery

✅ **No Rate Limits:**
- Send as many emails as needed
- No Supabase email quota concerns

✅ **Unified Email Provider:**
- Password resets from Resend
- Welcome emails from Resend
- All emails tracked in one dashboard

✅ **Professional Branding:**
- Custom sender domain (@quotetree.ai)
- Consistent sender name
- Better brand recognition

✅ **Better Monitoring:**
- Track all emails in Resend dashboard
- See delivery rates
- Monitor bounces and complaints

## Next Steps

After configuring SMTP:

1. **Test thoroughly:**
   - Request password reset
   - Check email arrives
   - Verify not in spam
   - Test reset link works

2. **Monitor for 24 hours:**
   - Check Resend logs
   - Check Supabase auth logs
   - Watch for any errors

3. **Test in production:**
   - Complete trial checkout
   - Verify both emails arrive
   - Password reset email (via SMTP)
   - Welcome email (via Resend API)

4. **Update documentation:**
   - Document your SMTP setup
   - Save credentials securely
   - Note any custom configurations

## Support

If you need help:

- **Resend Support:** https://resend.com/support
- **Resend Docs:** https://resend.com/docs
- **Supabase Docs:** https://supabase.com/docs/guides/auth/auth-smtp
- **Supabase Support:** https://supabase.com/dashboard/support

