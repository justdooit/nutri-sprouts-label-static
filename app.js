const PRODUCTS = [
  ["Mung Beans", "MGB"],
  ["Horse Gram", "HGM"],
  ["Chana", "CHN"],
  ["Green Peas", "GRP"],
  ["White Peas", "WHP"],
  ["Moth Beans", "MTB"],
  ["Black Peas", "BLP"],
  ["Vaal Bitter", "VAL"],
  ["Whole Masoor", "MSR"],
  ["Fenugreek Seeds", "FNS"],
  ["Ragi Millet", "RGM"],
];

const PRODUCT_CODE_BY_KEY = Object.fromEntries(
  PRODUCTS.map(([name, code]) => [normaliseProduct(name), code]),
);

const MM = 72 / 25.4;
const PAGE_W = 210 * MM;
const PAGE_H = 297 * MM;
const LABELS_PER_PAGE = 15;
const LABEL_COLUMNS = 3;
const LABEL_ROWS = 5;
const LABEL_W = 63 * MM;
const LABEL_H = 50 * MM;
const BOTTOM_W = 63 * MM;
const H_GAP = 0.1 * MM;
const V_GAP = 0.1 * MM;

const LABEL_FILL = "#8A5529";
const LABEL_STROKE = "#EEE8DF";
const FIELD_FILL = "#FFFFFF";
const FIELD_STROKE = "#70401D";
const FIELD_TEXT = "#000000";
const UNIT_TEXT = "#FFFFFF";
const BARCODE_BOX_FILL = "#FFFFFF";
const BARCODE_BOX_STROKE = "#70401D";
const BARCODE_TEXT = "#70401D";
const BARCODE_BAR = "#000000";

const CODE_128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const rowsEl = document.getElementById("orderRows");
const statusEl = document.getElementById("status");

document.getElementById("addRow").addEventListener("click", () => addRow());
document.getElementById("generatePdf").addEventListener("click", generateFromForm);

addRow({
  product: "Mung Beans",
  weight: 250,
  packed: todayIso(),
  quantity: 1,
});

function addRow(initial = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>
      <select class="product">
        ${PRODUCTS.map(([name]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
      </select>
    </td>
    <td><input class="weight" type="number" min="1" step="1" value="${initial.weight || 250}" /></td>
    <td><input class="packed" type="date" value="${initial.packed || todayIso()}" /></td>
    <td><input class="quantity" type="number" min="1" step="1" value="${initial.quantity || 1}" /></td>
    <td class="barcode"></td>
    <td><button class="danger" type="button">Remove</button></td>
  `;
  rowsEl.appendChild(tr);
  tr.querySelector(".product").value = initial.product || PRODUCTS[0][0];
  tr.querySelector(".danger").addEventListener("click", () => {
    tr.remove();
    refreshBarcodes();
  });
  tr.querySelectorAll("select,input").forEach((el) => el.addEventListener("input", refreshBarcodes));
  refreshBarcodes();
}

function refreshBarcodes() {
  for (const tr of rowsEl.querySelectorAll("tr")) {
    const data = readRow(tr);
    tr.querySelector(".barcode").textContent = makeBarcode(data.product, data.weight);
  }
}

function generateFromForm() {
  const labels = [];
  for (const tr of rowsEl.querySelectorAll("tr")) {
    const row = readRow(tr);
    if (!row.product || !row.weight || !row.packed || row.quantity <= 0) continue;
    const label = {
      product: row.product,
      weight: `${row.weight} gm`,
      packed: formatDateForLabel(row.packed),
      barcode: makeBarcode(row.product, row.weight),
    };
    for (let i = 0; i < row.quantity; i += 1) labels.push(label);
  }

  if (!labels.length) {
    statusEl.textContent = "Add at least one valid row.";
    return;
  }

  const pdfBytes = buildPdf(labels);
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nutri-sprouts-labels.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  statusEl.textContent = `Created ${labels.length} label${labels.length === 1 ? "" : "s"}.`;
}

function readRow(tr) {
  return {
    product: tr.querySelector(".product").value,
    weight: Math.max(0, Math.floor(Number(tr.querySelector(".weight").value || 0))),
    packed: tr.querySelector(".packed").value,
    quantity: Math.max(0, Math.floor(Number(tr.querySelector(".quantity").value || 0))),
  };
}

function buildPdf(labels) {
  const streams = [];
  for (let start = 0; start < labels.length; start += LABELS_PER_PAGE) {
    streams.push(drawPage(labels.slice(start, start + LABELS_PER_PAGE)));
  }
  return assemblePdf(streams);
}

function drawPage(labels) {
  let content = "";
  const left0 = (PAGE_W - (LABEL_COLUMNS * LABEL_W + (LABEL_COLUMNS - 1) * H_GAP)) / 2;
  const top0 = (PAGE_H - (LABEL_ROWS * LABEL_H + (LABEL_ROWS - 1) * V_GAP)) / 2;

  for (let i = 0; i < labels.length; i += 1) {
    const row = Math.floor(i / LABEL_COLUMNS);
    const col = i % LABEL_COLUMNS;
    const label = labels[i];
    const x = left0 + col * (LABEL_W + H_GAP);
    const yTop = PAGE_H - top0 - row * (LABEL_H + V_GAP);
    const y = yTop - LABEL_H;
    const bottomInset = (LABEL_W - BOTTOM_W) / 2;
    const clip = 1.2 * MM;

    content += `${rgb(LABEL_FILL)} rg ${rgb(LABEL_STROKE)} RG 0.5 w\n`;
    content += `${format(x + clip)} ${format(yTop)} m `
      + `${format(x + LABEL_W - clip)} ${format(yTop)} l `
      + `${format(x + LABEL_W)} ${format(yTop - clip)} l `
      + `${format(x + LABEL_W - bottomInset)} ${format(y)} l `
      + `${format(x + bottomInset)} ${format(y)} l `
      + `${format(x)} ${format(yTop - clip)} l h B\n`;

    const pad = 4.1 * MM;
    const innerX = x + pad;
    const innerW = LABEL_W - pad * 2;

    const pillHeight = 6.2 * MM;
    const productPillY = yTop - 15.5 * MM;
    const weightPillY = yTop - 27.0 * MM;
    const packedPillY = yTop - 38.5 * MM;
    const weightPillW = 20.0 * MM;
    const barcodeY = yTop - 49.0 * MM;

    content += drawTextLeft(innerX, yTop - 6.4 * MM, "PRODUCT", 6, "#F7E5CC");
    content += drawRoundedRect(innerX + 45, productPillY + 18, (45 * MM) - pad * 2, pillHeight, pillHeight / 2, FIELD_FILL, FIELD_STROKE);
    content += drawTextLeft(innerX + 55, (productPillY + 18) + 1.6 * MM, fit(label.product, 40), 10, FIELD_TEXT);

    content += drawTextLeft(innerX, yTop - 15.9 * MM, "WEIGHT", 6, "#F7E5CC");
    content += drawRoundedRect(innerX + 45, weightPillY + 25, weightPillW, pillHeight, pillHeight / 2, FIELD_FILL, FIELD_STROKE);
    content += drawTextLeft(innerX + 55, (weightPillY + 25) + 1.6 * MM, fit(weightNumber(label.weight), 8), 10, FIELD_TEXT);
    content += drawTextLeft((innerX + 45) + weightPillW + 1.4 * MM, (weightPillY + 25) + 1.5 * MM, "gm", 10, UNIT_TEXT);

    content += drawTextLeft(innerX, yTop - 24.4 * MM, "PACKED ON", 6, "#F7E5CC");
    content += drawRoundedRect(innerX + 45, packedPillY + 32, (35 * MM) - pad * 2, pillHeight, pillHeight / 2, FIELD_FILL, FIELD_STROKE);
    content += drawTextLeft(innerX + 55, (packedPillY + 32) + 1.85 * MM, fit(label.packed, 18), 10, FIELD_TEXT);

    content += drawRoundedRect(innerX - 2, barcodeY + 5, innerW + 5, 18 * MM, 1.2 * MM, BARCODE_BOX_FILL, BARCODE_BOX_STROKE);
    content += drawText(innerX, barcodeY + 5 + 0.75 * MM, fit(label.barcode, 16), 5.0, BARCODE_TEXT, innerW);
    content += drawCode128Barcode(innerX + 2.0 * MM, barcodeY + 5 + 3.25 * MM, innerW - 4.0 * MM, 13 * MM, label.barcode, BARCODE_BAR);
  }
  return content;
}

function assemblePdf(streams) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("");
  const fontRegularId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBoldId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds = [];

  for (const stream of streams) {
    const streamId = add(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`);
    const pageId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${format(PAGE_W)} ${format(PAGE_H)}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function drawText(x, y, text, size, color, centerWidth) {
  const value = String(text || "");
  const approx = value.length * size * 0.52;
  const tx = x + (centerWidth - approx) / 2;
  return `BT /F2 ${format(size)} Tf ${rgb(color)} rg 1 0 0 1 ${format(tx)} ${format(y)} Tm (${escapePdf(value)}) Tj ET\n`;
}

function drawTextLeft(x, y, text, size, color) {
  return `BT /F2 ${format(size)} Tf ${rgb(color)} rg 1 0 0 1 ${format(x)} ${format(y)} Tm (${escapePdf(text)}) Tj ET\n`;
}

function drawRoundedRect(x, y, width, height, radius, fill, stroke) {
  const r = Math.min(radius, Math.min(width, height) / 2);
  const k = 0.5522847498;
  const c = r * k;
  return `${rgb(fill)} rg ${rgb(stroke)} RG 0.25 w\n`
    + `${format(x + r)} ${format(y)} m `
    + `${format(x + width - r)} ${format(y)} l `
    + `${format(x + width - r + c)} ${format(y)} ${format(x + width)} ${format(y + r - c)} ${format(x + width)} ${format(y + r)} c `
    + `${format(x + width)} ${format(y + height - r)} l `
    + `${format(x + width)} ${format(y + height - r + c)} ${format(x + width - r + c)} ${format(y + height)} ${format(x + width - r)} ${format(y + height)} c `
    + `${format(x + r)} ${format(y + height)} l `
    + `${format(x + r - c)} ${format(y + height)} ${format(x)} ${format(y + height - r + c)} ${format(x)} ${format(y + height - r)} c `
    + `${format(x)} ${format(y + r)} l `
    + `${format(x)} ${format(y + r - c)} ${format(x + r - c)} ${format(y)} ${format(x + r)} ${format(y)} c h B\n`;
}

function drawCode128Barcode(x, y, width, height, value, barColor) {
  const cleaned = sanitiseCode128(value);
  const codes = [104];
  for (let i = 0; i < cleaned.length; i += 1) codes.push(cleaned.charCodeAt(i) - 32);
  let checksum = 104;
  for (let i = 1; i < codes.length; i += 1) checksum += codes[i] * i;
  codes.push(checksum % 103);
  codes.push(106);

  let modules = 0;
  for (const code of codes) {
    for (const char of CODE_128_PATTERNS[code]) modules += Number(char);
  }

  const moduleWidth = width / modules;
  let cursor = x;
  let bars = `${rgb(barColor)} rg\n`;
  for (const code of codes) {
    const pattern = CODE_128_PATTERNS[code];
    let drawBar = true;
    for (const char of pattern) {
      const segmentWidth = Number(char) * moduleWidth;
      if (drawBar) {
        bars += `${format(cursor)} ${format(y)} ${format(segmentWidth)} ${format(height)} re f\n`;
      }
      cursor += segmentWidth;
      drawBar = !drawBar;
    }
  }
  return bars;
}

function makeBarcode(product, weight) {
  const code = PRODUCT_CODE_BY_KEY[normaliseProduct(product)] || normaliseProduct(product).slice(0, 3);
  return `NS${code}${Math.max(0, Math.floor(Number(weight || 0)))}`;
}

function normaliseProduct(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function sanitiseCode128(value) {
  const cleaned = String(value || "").toUpperCase().replace(/[^\x20-\x7E]/g, "");
  return cleaned || "NSMGB250";
}

function weightNumber(weight) {
  return String(weight || "").replace(/\s*gm\s*$/i, "").trim();
}

function fit(text, maxChars) {
  const value = String(text || "");
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}...`;
}

function rgb(hex) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  return `${format(r)} ${format(g)} ${format(b)}`;
}

function format(number) {
  return Number(number).toFixed(2);
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function escapePdf(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateForLabel(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
