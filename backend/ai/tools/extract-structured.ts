/**
 * extract-structured.ts
 * Parses receipts, invoices, tables, and any structured document.
 * Returns CSV, JSON, or formatted table output.
 */

import axios from "axios";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

export interface ExtractionResult {
  format: "csv" | "json" | "table";
  data: string;
  headers?: string[];
  rows?: string[][];
  label: string;
}

const EXTRACT_SYSTEM = `You are a precision data extraction engine. 
When given text from a document (receipt, invoice, table, spreadsheet, report), you extract all structured data and return it in the requested format.
Always return valid, well-formed output. For CSV, always include a header row. For JSON, always return a valid JSON array or object.
Extract EVERY piece of data you can find — don't skip rows or columns.`;

export async function extractToCSV(documentText: string, filename: string): Promise<ExtractionResult> {
  const prompt = `${EXTRACT_SYSTEM}

Document: "${filename}"

Content:
${documentText}

Extract all structured data from this document and output it as a valid CSV.
- Always start with a header row
- Quote fields that contain commas or newlines
- Include all items, rows, line items, or data points
- If it's a receipt, extract: Item, Quantity, Price, Total, Tax, Date, Vendor, etc.
- If it's a table, preserve the column structure

Return ONLY the CSV content, nothing else.`;

  try {
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      { model: textModel, prompt, stream: false },
      { timeout: 120_000 }
    );

    const csvText = (response.data?.response as string || "").trim();
    const lines = csvText.split("\n").filter((l: string) => l.trim());
    const headers = lines[0]?.split(",").map((h: string) => h.trim().replace(/^"|"$/g, "")) || [];
    const rows = lines.slice(1).map((line: string) => line.split(",").map((c: string) => c.trim().replace(/^"|"$/g, "")));

    return {
      format: "csv",
      data: csvText,
      headers,
      rows,
      label: `Extracted data from ${filename}`,
    };
  } catch (err: any) {
    throw new Error(`CSV extraction failed: ${err?.message || err}`);
  }
}

export async function extractToJSON(documentText: string, filename: string): Promise<ExtractionResult> {
  const prompt = `${EXTRACT_SYSTEM}

Document: "${filename}"

Content:
${documentText}

Extract all structured data and return it as a valid JSON array of objects.
Each object should represent one row/item/entry.
Return ONLY the JSON, nothing else. No markdown fences.`;

  try {
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      { model: textModel, prompt, stream: false },
      { timeout: 120_000 }
    );

    let jsonText = (response.data?.response as string || "").trim();
    // Strip markdown fences if present
    jsonText = jsonText.replace(/^```json\n?/i, "").replace(/```$/, "").trim();

    // Validate JSON
    JSON.parse(jsonText);

    return {
      format: "json",
      data: jsonText,
      label: `JSON data from ${filename}`,
    };
  } catch (err: any) {
    throw new Error(`JSON extraction failed: ${err?.message || err}`);
  }
}

export async function runExtractionTool(
  documentText: string,
  filename: string,
  outputFormat: "csv" | "json" = "csv"
): Promise<ExtractionResult> {
  if (outputFormat === "json") {
    return extractToJSON(documentText, filename);
  }
  return extractToCSV(documentText, filename);
}
