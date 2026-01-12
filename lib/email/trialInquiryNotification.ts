import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface TrialInquiryData {
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
}

export async function sendTrialInquiryNotification(data: TrialInquiryData) {
  const { fullName, email, phone, companyName } = data;
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'full',
    timeStyle: 'long',
  });

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Trial Inquiry</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #ffffff; padding: 40px 30px; border-radius: 8px; border: 1px solid #e5e7eb;">
    <h1 style="margin: 0 0 20px 0; font-size: 24px; color: #2d5a47;">🎯 New Free Trial Inquiry</h1>
    
    <p style="margin: 0 0 25px 0; font-size: 16px; color: #666;">
      Someone just submitted the free trial form on your landing page:
    </p>

    <div style="background: #f9fafb; padding: 20px; border-radius: 8px; border-left: 4px solid #2d5a47; margin-bottom: 25px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; font-weight: 600; color: #374151; width: 140px;">Full Name:</td>
          <td style="padding: 8px 0; color: #111827;">${fullName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600; color: #374151;">Email:</td>
          <td style="padding: 8px 0; color: #111827;">
            <a href="mailto:${email}" style="color: #2d5a47; text-decoration: none;">${email}</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600; color: #374151;">Phone:</td>
          <td style="padding: 8px 0; color: #111827;">
            <a href="tel:${phone}" style="color: #2d5a47; text-decoration: none;">${phone}</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600; color: #374151;">Company:</td>
          <td style="padding: 8px 0; color: #111827;">${companyName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600; color: #374151;">Submitted:</td>
          <td style="padding: 8px 0; color: #111827;">${timestamp}</td>
        </tr>
      </table>
    </div>

    <div style="background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b; margin-bottom: 20px;">
      <p style="margin: 0; font-size: 14px; color: #92400e;">
        <strong>⚡ Action Required:</strong> This lead has been redirected to complete their Stripe checkout. Follow up if they don't complete the trial signup.
      </p>
    </div>

    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 14px; color: #9ca3af;">
        This notification was sent from your QuoteTree landing page free trial form.
      </p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    const { data: emailData, error } = await resend.emails.send({
      from: 'QuoteTree Alerts <sam@quotetree.ai>',
      to: ['sam@quotetree.ai'],
      subject: `🎯 New Trial Inquiry: ${fullName} - ${companyName}`,
      html: htmlContent,
    });

    if (error) {
      console.error('Resend error:', error);
      throw error;
    }

    return emailData;
  } catch (error) {
    console.error('Failed to send trial inquiry notification:', error);
    throw error;
  }
}

