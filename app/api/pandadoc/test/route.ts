import { NextResponse } from "next/server";
import {
  verifyConnection,
  getPandaDocEnv,
  PandaDocApiError,
} from "@/lib/pandadoc/client";

/**
 * GET /api/pandadoc/test
 *
 * Verifies the PandaDoc API key is valid by making a lightweight authenticated
 * request. Returns only a success/failure indicator — no credentials, raw API
 * responses, or sensitive data are ever sent to the client.
 *
 * Sandbox mode only. Sending/signature logic is not implemented here.
 */
export async function GET() {
  try {
    await verifyConnection();

    return NextResponse.json({
      success: true,
      environment: getPandaDocEnv(),
      message: "PandaDoc connection successful.",
    });
  } catch (error) {
    if (error instanceof PandaDocApiError) {
      return NextResponse.json(
        {
          success: false,
          message: "PandaDoc authentication failed.",
          status: error.status,
          ...(error.code ? { code: error.code } : {}),
        },
        { status: 502 }
      );
    }

    const isMissingKey =
      error instanceof Error && error.message.includes("PANDADOC_API_KEY");

    return NextResponse.json(
      {
        success: false,
        message: isMissingKey
          ? "PandaDoc API key is not configured on this server."
          : "An unexpected error occurred while contacting PandaDoc.",
      },
      { status: isMissingKey ? 500 : 502 }
    );
  }
}
