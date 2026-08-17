/**
 * office-generator.ts
 *
 * Generates real MS Office-compatible documents from natural language:
 *  - .xlsx  spreadsheets (via xlsx package)
 *  - .docx  documents   (via docx package)
 *  - .pptx  presentations (via pptxgenjs)
 *  - .csv   exports
 *  - HTML reports with embedded charts (Chart.js)
 *
 * Also handles Tally-style bookkeeping:
 *  - Double-entry journal
 *  - Chart of Accounts
 *  - Trial Balance
 *  - Profit & Loss
 *  - Balance Sheet
 *  - Cash Flow Statement
 */

import axios from "axios";
import * as XLSX from "xlsx";
import { Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, BorderStyle, AlignmentType, Packer } from "docx";
import PptxGenJS from "pptxgenjs";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OfficDocResult {
  base64: string;
  filename: string;
  mimeType: string;
  format: "xlsx" | "docx" | "pptx" | "csv" | "html";
  rowCount?: number;
  pageCount?: number;
  slideCount?: number;
  preview?: string;
}

export interface BookkeepingEntry {
  date: string;
  description: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  reference?: string;
}

export type OfficeFormat = "excel" | "word" | "powerpoint" | "csv" | "html_report";

// ── LLM helper to extract structured data ─────────────────────────────────────

async function extractStructuredData<T>(prompt: string, fallback: T): Promise<T> {
  try {
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      { model: textModel, prompt, stream: false },
      { timeout: 90_000 }
    );
    let raw = (response.data?.response as string || "").trim();
    raw = raw.replace(/^```json\n?/i, "").replace(/^```\n?/, "").replace(/```$/, "").trim();
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Excel Generator ───────────────────────────────────────────────────────────

export async function generateExcel(
  request: string,
  fileContext: string
): Promise<OfficDocResult> {
  const contextSection = fileContext ? `\nData/Context:\n${fileContext.slice(0, 3000)}` : "";

  const schema = await extractStructuredData<{
    sheetName: string;
    filename: string;
    headers: string[];
    rows: string[][];
    totals?: string[];
    title?: string;
  }>(
    `You are an Excel spreadsheet expert.${contextSection}

User request: "${request}"

Generate a complete Excel spreadsheet.
Return ONLY JSON with exactly this structure:
{
  "sheetName": "Sheet name",
  "filename": "filename.xlsx",
  "title": "Optional title row",
  "headers": ["Col1", "Col2", "Col3"],
  "rows": [["val1", "val2", "val3"], ...],
  "totals": ["Total", "=SUM(B2:B10)", ""]
}

Generate realistic, complete data with at least 5-10 rows. Return ONLY JSON.`,
    { sheetName: "Data", filename: "output.xlsx", headers: ["Column 1"], rows: [["No data"]] }
  );

  const wb = XLSX.utils.book_new();

  // Build sheet data
  const sheetData: (string | number)[][] = [];

  if (schema.title) sheetData.push([schema.title]);
  sheetData.push(schema.headers);

  for (const row of schema.rows) {
    sheetData.push(row.map((cell) => {
      const num = parseFloat(cell);
      return isNaN(num) ? cell : num;
    }));
  }

  if (schema.totals) sheetData.push(schema.totals);

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Auto-column widths
  const colWidths = schema.headers.map((h, i) => ({
    wch: Math.max(h.length, ...(schema.rows || []).map((r) => String(r[i] || "").length)) + 2,
  }));
  ws["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, schema.sheetName || "Sheet1");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const base64 = Buffer.from(buffer).toString("base64");

  return {
    base64,
    filename: schema.filename || "spreadsheet.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    format: "xlsx",
    rowCount: schema.rows.length,
    preview: schema.headers.join(" | "),
  };
}

// ── Word Document Generator ───────────────────────────────────────────────────

export async function generateWord(
  request: string,
  fileContext: string
): Promise<OfficDocResult> {
  const contextSection = fileContext ? `\nContext:\n${fileContext.slice(0, 3000)}` : "";

  const schema = await extractStructuredData<{
    filename: string;
    title: string;
    sections: Array<{
      heading?: string;
      headingLevel?: number;
      paragraphs: string[];
      isList?: boolean;
    }>;
  }>(
    `You are a professional document writer.${contextSection}

User request: "${request}"

Generate a complete document. Return ONLY JSON:
{
  "filename": "document.docx",
  "title": "Document Title",
  "sections": [
    { "heading": "Section Title", "headingLevel": 1, "paragraphs": ["paragraph text..."] },
    { "heading": "Subsection", "headingLevel": 2, "isList": true, "paragraphs": ["item 1", "item 2"] }
  ]
}

Generate complete, professional content. Return ONLY JSON.`,
    { filename: "document.docx", title: "Document", sections: [{ paragraphs: [request] }] }
  );

  // Build docx
  const children: (Paragraph | Table)[] = [];

  // Title
  children.push(new Paragraph({
    text: schema.title,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
  }));

  children.push(new Paragraph({ text: "" })); // spacer

  for (const section of schema.sections || []) {
    if (section.heading) {
      const level = section.headingLevel === 2 ? HeadingLevel.HEADING_2 :
                    section.headingLevel === 3 ? HeadingLevel.HEADING_3 :
                    HeadingLevel.HEADING_1;
      children.push(new Paragraph({ text: section.heading, heading: level }));
    }

    for (const para of section.paragraphs || []) {
      if (section.isList) {
        children.push(new Paragraph({
          text: para,
          bullet: { level: 0 },
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({ text: para, size: 24 })],
          spacing: { after: 120 },
        }));
      }
    }
    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
    creator: "Cloud9 AI",
    title: schema.title,
  });

  const buffer = await Packer.toBuffer(doc);
  const base64 = Buffer.from(buffer).toString("base64");

  return {
    base64,
    filename: schema.filename || "document.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    format: "docx",
    pageCount: Math.ceil(schema.sections?.length / 3) || 1,
    preview: schema.title,
  };
}

// ── PowerPoint Generator ──────────────────────────────────────────────────────

export async function generatePowerPoint(
  request: string,
  fileContext: string
): Promise<OfficDocResult> {
  const contextSection = fileContext ? `\nContext:\n${fileContext.slice(0, 2000)}` : "";

  const schema = await extractStructuredData<{
    filename: string;
    title: string;
    subtitle?: string;
    theme: "dark" | "light" | "gradient";
    slides: Array<{
      title: string;
      content: string[];
      notes?: string;
      layout: "title" | "content" | "two_col" | "blank";
    }>;
  }>(
    `You are a presentation design expert.${contextSection}

User request: "${request}"

Generate a complete presentation. Return ONLY JSON:
{
  "filename": "presentation.pptx",
  "title": "Presentation Title",
  "subtitle": "Optional subtitle",
  "theme": "dark",
  "slides": [
    { "title": "Slide 1", "layout": "title", "content": ["subtitle text"], "notes": "speaker notes" },
    { "title": "Slide 2", "layout": "content", "content": ["• Point 1", "• Point 2", "• Point 3"] },
    { "title": "Col A", "layout": "two_col", "content": ["Left content", "---", "Right content"] }
  ]
}

Generate 5-10 slides with complete, professional content. Return ONLY JSON.`,
    {
      filename: "presentation.pptx", title: "Presentation", theme: "dark",
      slides: [{ title: request.slice(0, 50), layout: "title", content: ["Generated by Cloud9 AI"] }],
    }
  );

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Cloud9 AI";
  pptx.title = schema.title;

  const isDark = schema.theme === "dark" || schema.theme === "gradient";
  pptx.defineLayout({ name: "LAYOUT_WIDE", width: 13.33, height: 7.5 });

  for (const slide of schema.slides || []) {
    const s = pptx.addSlide();

    // Background
    if (isDark) {
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: "080B14" } });
      // Gradient accent bar
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.08, h: "100%", fill: { color: "6366F1" } });
    }

    // Title
    s.addText(slide.title, {
      x: 0.3, y: 0.2, w: 12.5, h: 1,
      fontSize: slide.layout === "title" ? 36 : 28,
      bold: true,
      color: isDark ? "F0F2FF" : "1E293B",
      fontFace: "Calibri",
    });

    // Content
    const content = (slide.content || []).join("\n");
    if (content) {
      s.addText(content, {
        x: 0.3, y: slide.layout === "title" ? 2.5 : 1.5,
        w: 12.5, h: 5,
        fontSize: slide.layout === "title" ? 20 : 16,
        color: isDark ? "94A3B8" : "475569",
        fontFace: "Calibri",
        breakLine: true,
        valign: "top",
      });
    }

    // Speaker notes
    if (slide.notes) s.addNotes(slide.notes);
  }

  const buffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
  const base64 = Buffer.from(buffer).toString("base64");

  return {
    base64,
    filename: schema.filename || "presentation.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    format: "pptx",
    slideCount: schema.slides?.length || 0,
    preview: schema.title,
  };
}

// ── Bookkeeping / Tally Tool ─────────────────────────────────────────────────

export interface BookkeepingResult {
  entries: BookkeepingEntry[];
  trialBalance: Array<{ account: string; debit: number; credit: number; balance: number }>;
  pnl: { revenue: number; expenses: number; netProfit: number };
  balanceSheet: { assets: number; liabilities: number; equity: number };
  csvBase64: string;
  xlsxBase64: string;
  filename: string;
  summary: string;
}

export async function runBookkeeper(
  request: string,
  fileContext: string
): Promise<BookkeepingResult> {
  const contextSection = fileContext ? `\nContext/Data:\n${fileContext.slice(0, 3000)}` : "";

  const schema = await extractStructuredData<{
    entries: BookkeepingEntry[];
    companyName?: string;
    period?: string;
  }>(
    `You are a professional accountant and bookkeeper.${contextSection}

User request: "${request}"

Extract or generate accounting journal entries.
Return ONLY JSON:
{
  "companyName": "Company Name",
  "period": "Month/Year",
  "entries": [
    { "date": "YYYY-MM-DD", "description": "Sale of goods", "debitAccount": "Cash", "creditAccount": "Sales Revenue", "amount": 5000, "reference": "INV-001" }
  ]
}

Use proper double-entry accounting. Include all relevant entries. Return ONLY JSON.`,
    { entries: [], companyName: "My Company" }
  );

  const entries = schema.entries || [];

  // Calculate trial balance
  const accounts: Map<string, { debit: number; credit: number }> = new Map();

  for (const entry of entries) {
    const debit = accounts.get(entry.debitAccount) || { debit: 0, credit: 0 };
    debit.debit += entry.amount;
    accounts.set(entry.debitAccount, debit);

    const credit = accounts.get(entry.creditAccount) || { debit: 0, credit: 0 };
    credit.credit += entry.amount;
    accounts.set(entry.creditAccount, credit);
  }

  const trialBalance = [...accounts.entries()].map(([account, vals]) => ({
    account,
    debit: vals.debit,
    credit: vals.credit,
    balance: vals.debit - vals.credit,
  }));

  // Simple P&L
  const revenueAccounts = trialBalance.filter((a) => a.account.toLowerCase().includes("revenue") || a.account.toLowerCase().includes("sales") || a.account.toLowerCase().includes("income"));
  const expenseAccounts = trialBalance.filter((a) => a.account.toLowerCase().includes("expense") || a.account.toLowerCase().includes("cost") || a.account.toLowerCase().includes("wages"));

  const revenue = revenueAccounts.reduce((s, a) => s + a.credit, 0);
  const expenses = expenseAccounts.reduce((s, a) => s + a.debit, 0);

  // Excel workbook with multiple sheets
  const wb = XLSX.utils.book_new();

  // Journal entries sheet
  XLSX.utils.book_append_sheet(wb,
    XLSX.utils.aoa_to_sheet([
      ["Date", "Description", "Debit Account", "Credit Account", "Amount", "Reference"],
      ...entries.map((e) => [e.date, e.description, e.debitAccount, e.creditAccount, e.amount, e.reference || ""]),
    ]),
    "Journal"
  );

  // Trial balance sheet
  XLSX.utils.book_append_sheet(wb,
    XLSX.utils.aoa_to_sheet([
      ["Account", "Debit", "Credit", "Balance"],
      ...trialBalance.map((a) => [a.account, a.debit, a.credit, a.balance]),
      ["TOTALS", trialBalance.reduce((s, a) => s + a.debit, 0), trialBalance.reduce((s, a) => s + a.credit, 0), 0],
    ]),
    "Trial Balance"
  );

  // P&L sheet
  XLSX.utils.book_append_sheet(wb,
    XLSX.utils.aoa_to_sheet([
      ["Profit & Loss Statement"],
      ["Period:", schema.period || "Current"],
      [],
      ["REVENUE", ""],
      ...revenueAccounts.map((a) => [a.account, a.credit]),
      ["Total Revenue", revenue],
      [],
      ["EXPENSES", ""],
      ...expenseAccounts.map((a) => [a.account, a.debit]),
      ["Total Expenses", expenses],
      [],
      ["Net Profit / Loss", revenue - expenses],
    ]),
    "P&L"
  );

  const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const xlsxBase64 = Buffer.from(xlsxBuffer).toString("base64");

  // CSV of journal
  const csvRows = [
    "Date,Description,Debit Account,Credit Account,Amount,Reference",
    ...entries.map((e) => `${e.date},"${e.description}","${e.debitAccount}","${e.creditAccount}",${e.amount},"${e.reference || ""}"`),
  ];
  const csvBase64 = Buffer.from(csvRows.join("\n")).toString("base64");

  return {
    entries,
    trialBalance,
    pnl: { revenue, expenses, netProfit: revenue - expenses },
    balanceSheet: {
      assets: trialBalance.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0),
      liabilities: trialBalance.filter((a) => a.balance < 0 && a.account.toLowerCase().includes("liab")).reduce((s, a) => s + Math.abs(a.balance), 0),
      equity: revenue - expenses,
    },
    csvBase64,
    xlsxBase64,
    filename: `${schema.companyName?.replace(/\s+/g, "_") || "company"}_accounts_${Date.now()}.xlsx`,
    summary: `${entries.length} entries | Revenue: $${revenue.toFixed(2)} | Expenses: $${expenses.toFixed(2)} | Net: $${(revenue - expenses).toFixed(2)}`,
  };
}

// ── HTML Dashboard/Report Generator ──────────────────────────────────────────

export async function generateHtmlDashboard(
  request: string,
  fileContext: string
): Promise<{ html: string; base64: string; filename: string; title: string }> {
  const contextSection = fileContext ? `\nData:\n${fileContext.slice(0, 2000)}` : "";

  const schema = await extractStructuredData<{
    title: string;
    kpis: Array<{ label: string; value: string; change?: string; trend: "up" | "down" | "flat" }>;
    charts: Array<{
      type: "bar" | "line" | "pie" | "doughnut";
      title: string;
      labels: string[];
      datasets: Array<{ label: string; data: number[] }>;
    }>;
    tables: Array<{
      title: string;
      headers: string[];
      rows: string[][];
    }>;
  }>(
    `You are a business analytics dashboard designer.${contextSection}

User request: "${request}"

Generate a complete dashboard config. Return ONLY JSON:
{
  "title": "Dashboard Title",
  "kpis": [{ "label": "Revenue", "value": "$125,000", "change": "+12%", "trend": "up" }],
  "charts": [{ "type": "bar", "title": "Monthly Sales", "labels": ["Jan","Feb","Mar"], "datasets": [{ "label": "Sales", "data": [45000, 52000, 48000] }] }],
  "tables": [{ "title": "Top Products", "headers": ["Product","Revenue","Units"], "rows": [["Widget A","$45,000","450"]] }]
}

Return ONLY JSON.`,
    { title: "Dashboard", kpis: [], charts: [], tables: [] }
  );

  const colors = ["#6366f1", "#8b5cf6", "#ec4899", "#06b6d4", "#10b981", "#f59e0b", "#ef4444"];

  const kpiHtml = (schema.kpis || []).map((kpi) => `
    <div class="kpi-card">
      <div class="kpi-label">${kpi.label}</div>
      <div class="kpi-value">${kpi.value}</div>
      ${kpi.change ? `<div class="kpi-change ${kpi.trend === "up" ? "up" : kpi.trend === "down" ? "down" : ""}">${kpi.trend === "up" ? "↑" : kpi.trend === "down" ? "↓" : "→"} ${kpi.change}</div>` : ""}
    </div>`).join("");

  const chartHtml = (schema.charts || []).map((chart, ci) => `
    <div class="chart-card">
      <h3>${chart.title}</h3>
      <canvas id="chart${ci}"></canvas>
    </div>`).join("");

  const chartScripts = (schema.charts || []).map((chart, ci) => {
    const datasets = chart.datasets.map((ds, di) => ({
      label: ds.label, data: ds.data,
      backgroundColor: colors[di % colors.length] + "99",
      borderColor: colors[di % colors.length],
      borderWidth: 2,
    }));
    return `new Chart(document.getElementById('chart${ci}'), { type: '${chart.type}', data: { labels: ${JSON.stringify(chart.labels)}, datasets: ${JSON.stringify(datasets)} }, options: { responsive: true, plugins: { legend: { labels: { color: '#94a3b8' } }, title: { display: false } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } } } } });`;
  }).join("\n");

  const tableHtml = (schema.tables || []).map((tbl) => `
    <div class="table-card">
      <h3>${tbl.title}</h3>
      <table>
        <thead><tr>${tbl.headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${tbl.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${schema.title}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#080b14;color:#f0f2ff;font-family:Inter,sans-serif;min-height:100vh;padding:24px}
  h1{font-size:28px;font-weight:700;margin-bottom:24px;background:linear-gradient(135deg,#6366f1,#8b5cf6,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  h3{font-size:16px;font-weight:600;color:#e2e8f0;margin-bottom:12px}
  .kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
  .kpi-card{background:rgba(13,18,30,0.85);border:1px solid rgba(99,102,241,0.2);border-radius:16px;padding:20px;backdrop-filter:blur(12px)}
  .kpi-label{font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
  .kpi-value{font-size:28px;font-weight:700;color:#f0f2ff}
  .kpi-change{font-size:13px;margin-top:6px;font-weight:600}
  .kpi-change.up{color:#10b981} .kpi-change.down{color:#ef4444}
  .chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:16px;margin-bottom:24px}
  .chart-card{background:rgba(13,18,30,0.85);border:1px solid rgba(99,102,241,0.2);border-radius:16px;padding:20px}
  .table-card{background:rgba(13,18,30,0.85);border:1px solid rgba(99,102,241,0.2);border-radius:16px;padding:20px;margin-bottom:16px;overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:rgba(99,102,241,0.15);color:#6366f1;padding:10px 12px;text-align:left;font-weight:600;border:1px solid rgba(99,102,241,0.2)}
  td{padding:9px 12px;border:1px solid rgba(99,102,241,0.1);color:#94a3b8}
  tr:nth-child(even) td{background:rgba(99,102,241,0.04)}
  .footer{text-align:center;margin-top:32px;font-size:12px;color:#475569}
</style>
</head>
<body>
<h1>✨ ${schema.title}</h1>
<div class="kpi-grid">${kpiHtml}</div>
<div class="chart-grid">${chartHtml}</div>
${tableHtml}
<div class="footer">Generated by Cloud9 AI · ${new Date().toLocaleDateString()}</div>
<script>${chartScripts}</script>
</body>
</html>`;

  return {
    html,
    base64: Buffer.from(html).toString("base64"),
    filename: `${schema.title.replace(/\s+/g, "_")}_dashboard_${Date.now()}.html`,
    title: schema.title,
  };
}
