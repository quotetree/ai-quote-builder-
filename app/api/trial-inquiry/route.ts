import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendTrialInquiryNotification } from '@/lib/email/trialInquiryNotification';
import { google } from 'googleapis';

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

    // Create Supabase client with service role for inserting (bypasses RLS)
    const supabase = createServiceRoleClient();

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

    // Add to Google Sheets (non-blocking - don't fail if this fails)
    try {
      const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const sheetId = process.env.GOOGLE_SHEET_ID;

      if (serviceAccountJson && sheetId) {
        // Handle both escaped newlines and actual newlines in the private key
        let credentials;
        try {
          // First, try parsing as-is (in case it's already valid JSON)
          credentials = JSON.parse(serviceAccountJson);
        } catch {
          // If that fails, try replacing escaped newlines
          const fixedJson = serviceAccountJson
            .replace(/\\n/g, '\n')
            .replace(/\\\\/g, '\\');
          credentials = JSON.parse(fixedJson);
        }

        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const timestamp = new Date().toISOString();

        await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: 'Leads!A:F',
          valueInputOption: 'RAW',
          requestBody: {
            values: [[full_name, email, phone, company_name, 'Landing Page Trial Form', timestamp]],
          },
        });

        console.log('✅ Lead added to Google Sheet:', email);
      } else {
        console.log('⚠️ Google Sheets not configured (GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SHEET_ID missing)');
      }
    } catch (sheetsError) {
      console.error('❌ Google Sheets sync failed (non-critical):', sheetsError);
      // Don't fail the request if Google Sheets fails
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

