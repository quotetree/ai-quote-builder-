import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface OrganizationInviteParams {
  recipientEmail: string;
  organizationName: string;
  inviterName: string;
  role: 'super_admin' | 'admin';
  inviteToken: string;
}

export async function sendOrganizationInvite({
  recipientEmail,
  organizationName,
  inviterName,
  role,
  inviteToken,
}: OrganizationInviteParams) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://quotetree.ai';
  const acceptUrl = `${appUrl}/auth/accept-invite?token=${inviteToken}`;
  
  const roleDisplay = role === 'super_admin' ? 'Super Admin' : 'Admin';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've been invited to ${organizationName}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
  <!-- Preview text (hidden from view) -->
  <div style="display: none; max-height: 0; overflow: hidden;">
    ${inviterName} invited you to join ${organizationName} on QuoteTree
  </div>

  <div style="background: #ffffff; padding: 40px 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 30px;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #111827;">
        You've been invited to join
      </h1>
      <p style="margin: 8px 0 0 0; font-size: 20px; color: #16a34a; font-weight: 600;">
        ${organizationName}
      </p>
    </div>

    <!-- Invitation Details -->
    <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
      <p style="margin: 0 0 12px 0; font-size: 15px; color: #6b7280;">
        <strong style="color: #111827;">${inviterName}</strong> has invited you to join their organization on QuoteTree as a <strong style="color: #111827;">${roleDisplay}</strong>.
      </p>
      
      <p style="margin: 12px 0 0 0; font-size: 15px; color: #6b7280;">
        As a ${roleDisplay}, you'll be able to:
      </p>
      
      ${role === 'super_admin' ? `
      <ul style="margin: 12px 0 0 0; padding-left: 20px; font-size: 15px; color: #6b7280;">
        <li style="margin-bottom: 8px;">Create and edit projects & quotes</li>
        <li style="margin-bottom: 8px;">Manage the organization's price book</li>
        <li style="margin-bottom: 8px;">Invite and manage team members</li>
        <li style="margin-bottom: 8px;">View all organization projects and quotes</li>
      </ul>
      ` : `
      <ul style="margin: 12px 0 0 0; padding-left: 20px; font-size: 15px; color: #6b7280;">
        <li style="margin-bottom: 8px;">Create and edit projects & quotes</li>
        <li style="margin-bottom: 8px;">View the organization's price book (read-only)</li>
        <li style="margin-bottom: 8px;">View all organization projects and quotes</li>
      </ul>
      `}
    </div>

    <!-- Call to Action -->
    <div style="text-align: center; margin: 35px 0;">
      <a href="${acceptUrl}" style="display: inline-block; background-color: #16a34a; color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 2px 4px rgba(22, 163, 74, 0.2);">
        Accept Invitation
      </a>
    </div>

    <!-- Secondary Info -->
    <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
      <p style="margin: 0 0 12px 0; font-size: 14px; color: #6b7280;">
        This invitation will expire in <strong>7 days</strong>.
      </p>
      
      <p style="margin: 0; font-size: 14px; color: #6b7280;">
        If you don't have a QuoteTree account yet, clicking the button above will let you create one with this email address.
      </p>
    </div>

    <!-- Support Link -->
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
      <p style="margin: 0; font-size: 13px; color: #9ca3af;">
        Need help? Contact us at <a href="mailto:support@quotetree.ai" style="color: #16a34a; text-decoration: none;">support@quotetree.ai</a>
      </p>
    </div>
  </div>

  <!-- Footer -->
  <div style="text-align: center; margin-top: 30px; padding-top: 20px;">
    <p style="color: #9ca3af; font-size: 13px; margin: 0;">
      QuoteTree — Create professional quotes in minutes
    </p>
    <p style="color: #d1d5db; font-size: 12px; margin: 8px 0 0 0;">
      This invitation was sent to ${recipientEmail}
    </p>
  </div>
</body>
</html>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: 'QuoteTree <invites@quotetree.ai>',
      to: [recipientEmail],
      subject: `${inviterName} invited you to join ${organizationName} on QuoteTree`,
      html: htmlContent,
    });

    if (error) {
      console.error('Resend error:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to send organization invite email:', error);
    throw error;
  }
}

