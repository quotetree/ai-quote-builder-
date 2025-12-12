import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

// Allow POST method
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    
    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Use service role client - same as Stripe webhook
    const supabase = createServiceRoleClient();
    
    // Use resetPasswordForEmail with service role client
    // This generates hash-based tokens instead of PKCE codes
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
      }
    );

    if (resetError) {
      console.error('Password reset email error:', resetError);
      return NextResponse.json(
        { error: resetError.message },
        { status: 500 }
      );
    }

    console.log('✅ Password reset email sent successfully to:', email);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Password reset API error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to send password reset email' },
      { status: 500 }
    );
  }
}

