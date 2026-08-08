// 程序化生成应用图标：番茄图案 → assets/icon.ico + icon.png + tray.png
// 零依赖：手写 PNG 编码器（zlib 来自 node 内核）+ ICO 容器（小尺寸 BMP 条目、大尺寸 PNG 条目）
'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---------- PNG 编码 ----------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function pngEncode(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: None
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO 封装 ----------

// 32bpp BMP 条目（XOR 像素 + 1bpp AND 掩码），兼容性最好，用于小尺寸
function bmpEntry(rgba, w, h) {
  const andRow = ((w + 31) >> 5) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8); // XOR + AND 两层
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(w * h * 4 + andRow * h, 20);
  const xor = Buffer.alloc(w * h * 4);
  const and = Buffer.alloc(andRow * h);
  for (let y = 0; y < h; y++) {
    const srcRow = h - 1 - y; // BMP 自下而上
    for (let x = 0; x < w; x++) {
      const s = (srcRow * w + x) * 4;
      const d = (y * w + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
      if (rgba[s + 3] < 128) and[y * andRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, and]);
}

function buildIco(images) {
  // images: [{ w, data }]，data 为 BMP 条目或整个 PNG 文件
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.w === 256 ? 0 : img.w;
    e[1] = img.w === 256 ? 0 : img.w;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
    entries.push(e);
  }
  return Buffer.concat([dir, ...entries, ...images.map((i) => i.data)]);
}

// ---------- 番茄绘制 ----------

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

function lerp3(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}

// 返回 [r,g,b,a]（0-255），u/v ∈ [0,1]，v 向下
function scene(u, v, size) {
  let color = null;

  // 果体：椭圆 + 光照
  const bx = 0.5, by = 0.585, rx = 0.385, ry = 0.345;
  const d = Math.hypot((u - bx) / rx, (v - by) / ry);
  if (d <= 1) {
    const t = clamp(Math.hypot(u - 0.4, v - 0.46) / 0.55, 0, 1);
    let c = lerp3([255, 112, 88], [214, 45, 32], t);
    if (d > 0.8) c = lerp3(c, [150, 24, 16], ((d - 0.8) / 0.2) * 0.55);
    const hs = Math.hypot((u - 0.385) / 1.4, v - 0.44);
    if (hs < 0.085) c = lerp3(c, [255, 235, 225], 0.5 * (1 - hs / 0.085));
    color = c;
  }

  // 萼片：五瓣玫瑰线，叠在果体上方
  const lx = u - 0.5, ly = v - 0.27;
  const lr = Math.hypot(lx, ly);
  const theta = Math.atan2(ly, lx);
  const petal = Math.abs(Math.cos(2.5 * (theta - Math.PI / 2)));
  const rMax = 0.235 * (0.3 + 0.7 * Math.pow(petal, 1.2));
  if (lr < rMax) {
    color = lerp3([104, 186, 88], [34, 110, 46], clamp(lr / rMax, 0, 1));
  }

  // 果柄：短竖条（小尺寸下加粗保证可见）
  const halfW = Math.max(0.034, 1.0 / size);
  if (Math.abs(u - 0.5) < halfW && v > 0.09 && v < 0.24) {
    color = Math.abs(u - 0.5) > halfW * 0.6 ? [52, 92, 32] : [78, 128, 44];
  }

  return color ? [color[0], color[1], color[2], 255] : [0, 0, 0, 0];
}

function drawTomato(size) {
  const S = 3; // 3×3 超采样抗锯齿
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const [cr, cg, cb, ca] = scene((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size, size);
          r += cr * (ca / 255);
          g += cg * (ca / 255);
          b += cb * (ca / 255);
          a += ca;
        }
      }
      const n = S * S;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      // 预乘均值还原为直通 alpha
      rgba[i] = alpha > 0 ? Math.min(255, Math.round((r / n) / (alpha / 255))) : 0;
      rgba[i + 1] = alpha > 0 ? Math.min(255, Math.round((g / n) / (alpha / 255))) : 0;
      rgba[i + 2] = alpha > 0 ? Math.min(255, Math.round((b / n) / (alpha / 255))) : 0;
      rgba[i + 3] = Math.round(alpha);
    }
  }
  return rgba;
}

// ---------- 生成 ----------

const assets = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });

const icoImages = [16, 24, 32, 48, 64, 128, 256].map((size) => {
  const rgba = drawTomato(size);
  return { w: size, data: size <= 48 ? bmpEntry(rgba, size, size) : pngEncode(rgba, size, size) };
});
fs.writeFileSync(path.join(assets, 'icon.ico'), buildIco(icoImages));
fs.writeFileSync(path.join(assets, 'icon.png'), pngEncode(drawTomato(256), 256, 256));
fs.writeFileSync(path.join(assets, 'tray.png'), pngEncode(drawTomato(32), 32, 32));

console.log('已生成: icon.ico (%d KB), icon.png, tray.png',
  Math.round(fs.statSync(path.join(assets, 'icon.ico')).size / 1024));
