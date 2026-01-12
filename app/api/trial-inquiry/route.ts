import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendTrialInquiryNotification } from '@/lib/email/trialInquiryNotification';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { full_name, email, phone, company_name } = body;

    // Validate required fields
    if (!full_name || !email || !phone || !company_name) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Create Supabase client with service role for inserting
    const supabase = createClient();

    // Insert into database
    const { data: inquiry, error: dbError } = await supabase
      .from('trial_inquiries')
      .insert({
        full_name,
        email,
        phone,
        company_name,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json(
        { error: 'Failed to save inquiry' },
        { status: 500 }
      );
    }

    // Send email notification (non-blocking - don't fail if email fails)
    try {
      await sendTrialInquiryNotification({
        fullName: full_name,
        email,
        phone,
        companyName: company_name,
      });
    } catch (emailError) {
      console.error('Email notification failed (non-critical):', emailError);
      // Don't fail the request if email fails
    }

    return NextResponse.json(
      { 
        success: true,
        inquiry_id: inquiry.id,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Trial inquiry API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

