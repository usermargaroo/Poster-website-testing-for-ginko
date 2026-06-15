const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data', 'site.json');

// ── Middleware ───────────────────────────────────────────
app.use(express.json());

// Serve the Laz Posters folder as the web root
app.use(express.static(ROOT));

// Also serve MadeByGray Poster Files (they live one level up on Desktop)
const MBG_DIR = path.join(ROOT, '..', 'MadeByGray Poster Files');
if (fs.existsSync(MBG_DIR)) {
  app.use('/MadeByGray Poster Files', express.static(MBG_DIR));
}

// ── File upload (multer) ─────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(ROOT, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, Date.now() + ext);
    }
  })
});

// ── Data helpers ─────────────────────────────────────────
function read()        { return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
function write(data)   { fs.writeFileSync(DATA, JSON.stringify(data, null, 2)); }
function slug(str)     { return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// ── Upload ───────────────────────────────────────────────
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ path: 'uploads/' + req.file.filename });
});

// ── Sizes ────────────────────────────────────────────────
app.get('/api/sizes', (req, res) => res.json(read().sizes));

app.put('/api/sizes', (req, res) => {
  const data = read();
  data.sizes = req.body;
  write(data);
  res.json(data.sizes);
});

// ── Artists ──────────────────────────────────────────────
app.get('/api/artists', (req, res) => res.json(read().artists));

app.get('/api/artists/:id', (req, res) => {
  const artist = read().artists.find(a => a.id === req.params.id);
  if (!artist) return res.status(404).json({ error: 'Not found' });
  res.json(artist);
});

app.post('/api/artists', (req, res) => {
  const data = read();
  const { name, tagline, heroImage } = req.body;
  const id   = slug(name);
  const page = id + '.html';

  if (data.artists.find(a => a.id === id))
    return res.status(400).json({ error: 'Artist with that name already exists' });

  const artist = { id, name, tagline: tagline || '', heroImage: heroImage || '', page };
  data.artists.push(artist);
  write(data);

  // Generate HTML page for this artist based on laz-lewis.html template
  generateArtistPage(artist);

  res.json(artist);
});

app.put('/api/artists/:id', (req, res) => {
  const data = read();
  const idx  = data.artists.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.artists[idx] = { ...data.artists[idx], ...req.body };
  write(data);
  res.json(data.artists[idx]);
});

app.delete('/api/artists/:id', (req, res) => {
  const data   = read();
  const artist = data.artists.find(a => a.id === req.params.id);
  if (!artist) return res.status(404).json({ error: 'Not found' });

  data.artists  = data.artists.filter(a => a.id !== req.params.id);
  data.products = data.products.filter(p => p.artistId !== req.params.id);
  write(data);

  // Delete generated page (but never delete the original two pages)
  const safe = ['laz-lewis.html', 'madebygray.html'];
  const pg   = path.join(ROOT, artist.page);
  if (!safe.includes(artist.page) && fs.existsSync(pg)) fs.unlinkSync(pg);

  res.json({ ok: true });
});

// ── Products ─────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  let products = read().products;
  if (req.query.artistId) products = products.filter(p => p.artistId === req.query.artistId);
  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const data    = read();
  const product = data.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  const artist  = data.artists.find(a => a.id === product.artistId);
  res.json({
    ...product,
    artistName: artist?.name  || '',
    artistPage: artist?.page  || 'index.html',
    sizes:      data.sizes
  });
});

app.post('/api/products', (req, res) => {
  const data    = read();
  const { artistId, name, description, images } = req.body;
  const id      = (artistId.split('-')[0] || 'p') + '-' + Date.now();
  const product = { id, artistId, name, description: description || '', images: images || [] };
  data.products.push(product);
  write(data);
  res.json(product);
});

app.put('/api/products/:id', (req, res) => {
  const data = read();
  const idx  = data.products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.products[idx] = { ...data.products[idx], ...req.body };
  write(data);
  res.json(data.products[idx]);
});

app.delete('/api/products/:id', (req, res) => {
  const data = read();
  data.products = data.products.filter(p => p.id !== req.params.id);
  write(data);
  res.json({ ok: true });
});

// ── Artist page generator ────────────────────────────────
function generateArtistPage(artist) {
  const templatePath = path.join(ROOT, 'laz-lewis.html');
  if (!fs.existsSync(templatePath)) return;

  let html = fs.readFileSync(templatePath, 'utf8');

  // Swap the data-artist attribute
  html = html.replace(/data-artist="laz-lewis"/, `data-artist="${artist.id}"`);

  // Swap page title
  html = html.replace(/<title>.*?<\/title>/, `<title>${artist.name} — Ginko Posters</title>`);

  // Swap footer brand
  html = html.replace(
    /<span class="footer-brand">Laz Lewis<\/span>/,
    `<span class="footer-brand">${artist.name}</span>`
  );

  fs.writeFileSync(path.join(ROOT, artist.page), html);
}

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🌿  Ginko Posters server running');
  console.log(`    Site:  http://localhost:${PORT}`);
  console.log(`    Admin: http://localhost:${PORT}/admin.html\n`);
});
