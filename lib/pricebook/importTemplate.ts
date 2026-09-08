import Papa from "papaparse";
import * as XLSX from "xlsx";

/** Canonical Price Book import/export column headers (display order). */
export const PRICEBOOK_IMPORT_HEADERS = [
  "Product Name",
  "Product Code",
  "Product Family",
  "Product Brand",
  "Product Type",
  "List Price",
  "Sales Price",
  "Product Description",
] as const;

export type PricebookTemplateFormat = "csv" | "xls" | "xlsx";

function escapeCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const stringValue = String(value).replace(/"/g, '""');
  return /[",\n]/.test(stringValue) ? `"${stringValue}"` : stringValue;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildWorkbookSheet(rows: (string | number | null | undefined)[][]) {
  const aoa: (string | number)[][] = [
    [...PRICEBOOK_IMPORT_HEADERS],
    ...rows.map((row) =>
      row.map((cell) => (cell === null || cell === undefined ? "" : cell))
    ),
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

/** Empty catalog template (header row only) for users to fill and re-upload. */
export function downloadPricebookImportTemplate(format: PricebookTemplateFormat) {
  const filename = `pricebook-import-template.${format}`;

  if (format === "csv") {
    const csvContent = PRICEBOOK_IMPORT_HEADERS.map(escapeCsvValue).join(",") + "\n";
    triggerDownload(
      new Blob([csvContent], { type: "text/csv;charset=utf-8;" }),
      filename
    );
    return;
  }

  const sheet = buildWorkbookSheet([]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Products");
  const bookType = format === "xls" ? "xls" : "xlsx";
  const data = XLSX.write(workbook, { bookType, type: "array" });
  const mime =
    format === "xls"
      ? "application/vnd.ms-excel"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  triggerDownload(new Blob([data], { type: mime }), filename);
}

export function downloadPricebookCsvExport(
  rows: (string | number | null | undefined)[][],
  filename: string
) {
  const csvContent = [
    PRICEBOOK_IMPORT_HEADERS.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\n");

  triggerDownload(
    new Blob([csvContent], { type: "text/csv;charset=utf-8;" }),
    filename
  );
}

/** Parse a CSV or Excel file into header + row objects for the Price Book importer. */
export async function parsePricebookImportFile(
  file: File
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const name = file.name.toLowerCase();
  const isExcel = name.endsWith(".xlsx") || name.endsWith(".xls");

  if (!isExcel) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          resolve({
            headers: results.meta.fields || [],
            rows: (results.data as Record<string, unknown>[]) || [],
          });
        },
        error: (err: Error) => reject(err),
      });
    });
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { headers: [], rows: [] };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  const headers =
    json.length > 0
      ? Object.keys(json[0])
      : ((XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as string[]) || []);

  return { headers, rows: json };
}
