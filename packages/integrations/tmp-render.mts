import { PdfBuilder } from "/Users/sumanjana/Desktop/triakshi-school-managment-dasbord/packages/integrations/src/pdf.ts";
import { writeFileSync } from "node:fs";
const lines = [
 "₹1,23,456.00  Fee received ₹ 500.50 ŭ é",
 "प्रिया शर्मा क्षत्रिय विद्यालय ज्ञान श्री कृष्ण द्वारा ऑफ़िस",
 "ಕನ್ನಡ ಶಾಲೆ ವಿದ್ಯಾರ್ಥಿ ಕ್ಷ ಶ್ರೀ ಕೃಷ್ಣ ಪ್ರಿಯಾ",
 "তিথি বিদ্যালয় ক্ষত্রিয় শ্রী রাজ্য ড়ে",
 "தமிழ் பள்ளி ஸ்ரீ கொடு கிருஷ்ணா க்ஷ",
 "తెలుగు పాఠశాల క్ష శ్రీ కృష్ణ ప్రియ",
 "Mixed: Priya प्रिया ₹500 ತಿಥಿ 2026-27 Ünïcode 日本語",
];
const b = await PdfBuilder.create({ unicode: true });
await b.need(lines);
let y = 780;
for (const l of lines) { b.textAt(l, { x: 40, y, size: 20 }); y -= 40; b.textAt(l, { x: 40, y, size: 20, bold: true }); y -= 50; }
const bytes = await b.save();
writeFileSync(process.argv[2]!, bytes); console.log(bytes.length);
