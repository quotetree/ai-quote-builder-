import {
  DetectDocumentTextCommand,
  TextractClient,
} from "@aws-sdk/client-textract";
import type { OcrProvider, OcrResult } from "@/lib/ai/ocr/ocrProvider";

export class TextractOcrProvider implements OcrProvider {
  private client: TextractClient;

  constructor() {
    this.client = new TextractClient({
      region: process.env.AWS_REGION ?? "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  async detectText(imageBuffer: Buffer): Promise<OcrResult> {
    const response = await this.client.send(
      new DetectDocumentTextCommand({
        Document: { Bytes: imageBuffer },
      }),
    );

    const lines: string[] = [];
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const block of response.Blocks ?? []) {
      if (block.BlockType === "LINE" && block.Text) {
        lines.push(block.Text);
        if (block.Confidence != null) {
          confidenceSum += block.Confidence;
          confidenceCount += 1;
        }
      }
    }

    return {
      text: lines.join("\n").trim(),
      confidence: confidenceCount > 0 ? confidenceSum / confidenceCount / 100 : 0,
    };
  }
}
