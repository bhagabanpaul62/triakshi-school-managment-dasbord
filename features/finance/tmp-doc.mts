import { qrSvg } from "@smw/integrations";
import { defaultConfig, sampleData, KINDS } from "./templates/config";
import { renderDocument } from "./templates/render";
import { writeFileSync, readFileSync } from "node:fs";
const out = process.argv[2]!;
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWM4ISd3Qk6OAUIBAB8mBBGFRCvEAAAAAElFTkSuQmCC", "base64"));
for (const [kind, layout, extra] of [["receipt","a5",{}],["receipt","a4",{}],["receipt","two_up",{}],["receipt","thermal80",{}],["invoice","a4",{}],["statement","a4",{many:1}],["payslip","a4",{}],["certificate","a4",{}],["voucher","a5",{}]] as const) {
  const cfg = { ...defaultConfig(kind, ["Triakshi Public School", "12 Main Road, Kolkata 700001", "UDISE 19010100101 · GSTIN 19ABCDE1234F1Z5"]), layout, watermark: kind==="receipt"&&layout==="a5"?"Draft":null, copies: ["School copy","Family copy"] };
  const d = sampleData(kind);
  d.qrSvg = qrSvg("https://x.example/verify/receipt/abcdefghijklmnop"); d.marks = ["DUPLICATE"];
  if ((extra as any).many) d.rows = Array.from({length: 60}, (_, i) => ({ date: "0"+(i%9+1)+" Apr", ref: "INV/2026-27/0000"+i, item: "प्रिया शर्मा Tuition fee instalment number "+i, debit: "₹12,000.00", credit: "", balance: "₹12,000.00" }));
  const bytes = await renderDocument(cfg, d, { assets: { logo: png, signature: png } });
  writeFileSync(`${out}/doc-${kind}-${layout}.pdf`, bytes); console.log(kind, layout, bytes.length);
}
