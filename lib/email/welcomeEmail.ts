import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendWelcomeEmail(email: string, firstName?: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://quotetree.ai';
  const greeting = firstName ? `Hey ${firstName},` : 'Hey,';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to QuoteTree</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <!-- Preview text (hidden from view) -->
  <div style="display: none; max-height: 0; overflow: hidden;">
    Glad you're here — let's help you quote faster.
  </div>

  <div style="background: #ffffff; padding: 40px 30px; border-radius: 8px;">
    <p style="margin: 0 0 20px 0; font-size: 16px;">${greeting}</p>

    <p style="margin: 0 0 20px 0; font-size: 16px;">
      I'm <strong>Sam Bettencourt</strong>, founder of QuoteTree.
    </p>

    <p style="margin: 0 0 20px 0; font-size: 16px;">
      I built QuoteTree because creating commercial grade quotes was slow, often inaccurate, and pulled time away from high-leverage work. I kept running into the same bottleneck when bidding on projects, and I knew there had to be a better way.
    </p>

    <p style="margin: 0 0 20px 0; font-size: 16px;">
      QuoteTree helps electricians, security installers, and trade contractors create clean, professional quotes in minutes—not hours. <strong>Faster quotes = more jobs won.</strong>
    </p>

    <p style="margin: 0 0 15px 0; font-size: 16px;">
      <strong>Here's how to get started:</strong>
    </p>

    <ol style="margin: 0 0 25px 0; padding-left: 25px; font-size: 16px;">
      <li style="margin-bottom: 12px;">
        <strong>Check your inbox for the secure "Set Your Password" email.</strong><br>
        <span style="color: #666; font-size: 15px;">(If you don't see it yet, give it a minute or check spam.)</span>
      </li>
      <li style="margin-bottom: 12px;">
        <strong>Add your price book and product catalog.</strong><br>
        <span style="color: #666; font-size: 15px;">Start with your most common materials, cameras, access control hardware, labor items, etc. This is what unlocks fast quoting.</span>
      </li>
      <li style="margin-bottom: 12px;">
        <strong>Start prompting QuoteTree to build a quote.</strong><br>
        <span style="color: #666; font-size: 15px;">Create a new project, tell the AI what the job includes, and watch it generate a complete quote instantly.</span>
      </li>
    </ol>

    <div style="margin: 30px 0; text-align: center;">
      <a href="${appUrl}/auth/signin" style="display: inline-block; background-color: #16a34a; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
        Log in to QuoteTree
      </a>
    </div>

    <p style="margin: 25px 0 0 0; font-size: 16px; color: #666; border-top: 1px solid #e5e7eb; padding-top: 20px;">
      <strong>P.S.</strong> Reply to this email and tell me what you're currently using for quotes right now.
    </p>

    <p style="margin: 10px 0 0 0; font-size: 16px; color: #666;">
      I read and respond to every message personally — your feedback directly helps improve QuoteTree.
    </p>

    <p style="margin: 25px 0 0 0; font-size: 16px;">
      Talk soon,<br>
      <strong>Sam</strong>
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
    <p style="color: #9ca3af; font-size: 14px; margin: 0;">
      QuoteTree — Create professional quotes in minutes
    </p>
  </div>
</body>
</html>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: 'Sam from QuoteTree <sam@quotetree.ai>',
      to: [email],
      subject: 'Welcome to QuoteTree 🙌',
      html: htmlContent,
    });

    if (error) {
      console.error('Resend error:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    throw error;
  }
}

