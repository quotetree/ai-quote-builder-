import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, phone, company, source } = body;

    // Validate required field
    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Get environment variables
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!serviceAccountJson || !sheetId) {
      console.error('Missing required environment variables: GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SHEET_ID');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Parse service account credentials and handle Vercel newline issue
    let credentials;
    try {
      // First, try parsing as-is (in case it's already valid JSON)
      credentials = JSON.parse(serviceAccountJson);
    } catch {
      try {
        // If that fails, try replacing escaped newlines and backslashes
        const fixedJson = serviceAccountJson
          .replace(/\\n/g, '\n')
          .replace(/\\\\/g, '\\');
        credentials = JSON.parse(fixedJson);
      } catch (parseError) {
        console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', parseError);
        return NextResponse.json(
          { error: 'Invalid service account credentials' },
          { status: 500 }
        );
      }
    }

    // Initialize Google Sheets API
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Prepare row data
    const timestamp = new Date().toISOString();
    const rowData = [
      name || '',
      email,
      phone || '',
      company || '',
      source || '',
      timestamp,
    ];

    // Append to Google Sheet
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Leads!A:F',
        valueInputOption: 'RAW',
        requestBody: {
          values: [rowData],
        },
      });

      console.log('✅ Lead successfully added to Google Sheet:', { email, name, company });

      return NextResponse.json(
        { success: true, message: 'Lead added to Google Sheet' },
        { status: 200 }
      );
    } catch (sheetsError: any) {
      console.error('❌ Google Sheets API error:', {
        message: sheetsError.message,
        code: sheetsError.code,
        errors: sheetsError.errors,
      });

      return NextResponse.json(
        { 
          error: 'Failed to add lead to Google Sheet',
          details: sheetsError.message 
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('❌ Unexpected error in /api/leads:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

