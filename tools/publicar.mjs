// Publica los datos de las páginas de Eclipse Kids en este repositorio.
// Uso: node tools/publicar.mjs <carpeta-entrada> <carpeta-repo>
//   <carpeta-entrada>/portal/<id>.json  documentos de la colección "portal" (id = token o "consulta")
//   <carpeta-entrada>/assets/<id>.jpg   imágenes referenciadas
// Cada página de familia se guarda cifrada (AES-GCM) con una clave que sale de su token:
// solo quien tiene el link de la familia puede leerla. La foto del homenajeado también va cifrada.
import fs from "node:fs";
import path from "node:path";

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error("uso: node tools/publicar.mjs <entrada> <repo>"); process.exit(1); }
const te = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", te.encode(s)));
const key = async (tk) => crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", te.encode("ek-k|" + tk)), "AES-GCM", false, ["encrypt"]);
const enc = async (tk, bytes) => { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(tk), bytes)); return { iv, ct }; };
const okId = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(s);
const mk = (d) => fs.mkdirSync(path.join(OUT, d), { recursive: true });
["d", "f"].forEach(mk);

const pdir = path.join(IN, "portal"), adir = path.join(IN, "assets");
const asset = (id) => { const f = path.join(adir, id + ".jpg"); return okId(id) && fs.existsSync(f) ? fs.readFileSync(f) : null; };
const keepD = new Set(), keepF = new Set(), pub = new Set();
let n = 0, fotos = 0, faltan = [];

for (const file of fs.readdirSync(pdir).filter((f) => f.endsWith(".json"))) {
  const id = file.slice(0, -5);
  const data = JSON.parse(fs.readFileSync(path.join(pdir, file), "utf8"));
  if (id === "consulta") {
    fs.writeFileSync(path.join(OUT, "consulta.json"), JSON.stringify(data));
    for (const k of ["fi", "fp", "fo"]) (data[k] || []).forEach((x) => pub.add(x));
    continue;
  }
  if (!/^[a-z0-9]{6,32}$/.test(id)) continue;
  data.b = "https://eclipsekidsapp.com.ar/";
  if (data.bf) pub.add(data.bf);
  for (const k of ["cat", "nov"]) (data[k] || []).forEach((x) => x && x.f && pub.add(x.f));
  const h = (await sha("ek-f|" + id)).slice(0, 32);
  const { iv, ct } = await enc(id, te.encode(JSON.stringify(data)));
  fs.writeFileSync(path.join(OUT, "d", h + ".json"), JSON.stringify({ iv: Buffer.from(iv).toString("base64"), ct: Buffer.from(ct).toString("base64") }));
  keepD.add(h + ".json"); n++;
  const ft = data.c && data.c.ft;
  if (ft) {
    const b = asset(ft);
    if (b) {
      const h2 = (await sha("ek-ft|" + id + "|" + ft)).slice(0, 32);
      const out = path.join(OUT, "f", h2 + ".bin");
      if (!fs.existsSync(out)) { const e = await enc(id, b); fs.writeFileSync(out, Buffer.concat([Buffer.from(e.iv), Buffer.from(e.ct)])); }
      keepF.add(h2 + ".bin"); fotos++;
    } else faltan.push(ft);
  }
}
// Quita páginas y fotos de familias que ya no están.
for (const f of fs.readdirSync(path.join(OUT, "d"))) if (!keepD.has(f)) fs.unlinkSync(path.join(OUT, "d", f));
for (const f of fs.readdirSync(path.join(OUT, "f"))) if (!keepF.has(f)) fs.unlinkSync(path.join(OUT, "f", f));
console.log(JSON.stringify({ paginas: n, fotos, faltan: [...new Set(faltan)], imagenesPublicas: [...pub].filter(okId) }));
