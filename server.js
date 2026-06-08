const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 7777;
const CONFIG_DIR = process.env.CONFIG_DIR || __dirname;
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

app.get('/api/config', (req, res) => res.json(loadConfig()));

app.post('/api/config', (req, res) => {
  _sabPathCache = null; // reset so new URL is re-probed
  saveConfig(req.body);
  res.json({ success: true });
});

// ── SABnzbd path auto-detection ───────────────────────────────────────────────
// Some installs use /sabnzbd/api (subdirectory), others use /api (root).

const SAB_PATHS = ['/sabnzbd/api', '/api'];

async function detectSabPath(baseUrl, apikey) {
  for (const p of SAB_PATHS) {
    try {
      const r = await axios.get(`${baseUrl}${p}`, {
        params: { mode: 'version', output: 'json', apikey },
        timeout: 8000,
        validateStatus: s => s === 200,
      });
      if (r.data && (r.data.version || r.data.status !== false)) return p;
    } catch (_) {}
  }
  return null;
}

// ── Test connections ──────────────────────────────────────────────────────────

app.post('/api/test/:service', async (req, res) => {
  const { service } = req.params;
  const { url, apikey } = req.body;
  if (!url || !apikey) return res.status(400).json({ error: 'URL and API key are required' });

  try {
    if (service === 'sabnzbd') {
      const detectedPath = await detectSabPath(url, apikey);
      if (!detectedPath) return res.status(503).json({ error: 'Could not reach SABnzbd — check URL and API key' });
      // Fetch version for display
      const r = await axios.get(`${url}${detectedPath}`, {
        params: { mode: 'version', output: 'json', apikey },
        timeout: 8000,
      });
      return res.json({ success: true, version: r.data.version, sabPath: detectedPath });
    }

    if (service === 'sonarr') {
      const r = await axios.get(`${url}/api/v3/system/status`, {
        headers: { 'X-Api-Key': apikey },
        timeout: 10000,
      });
      return res.json({ success: true, version: r.data.version });
    }

    if (service === 'radarr') {
      const r = await axios.get(`${url}/api/v3/system/status`, {
        headers: { 'X-Api-Key': apikey },
        timeout: 10000,
      });
      return res.json({ success: true, version: r.data.version });
    }

    if (service === 'nzbhydra') {
      await axios.get(`${url}/api`, {
        params: { t: 'caps', o: 'json', apikey },
        timeout: 10000,
      });
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Unknown service' });
  } catch (e) {
    const msg = e.response
      ? `HTTP ${e.response.status}: ${e.response.statusText}`
      : e.code === 'ECONNREFUSED'
      ? 'Connection refused — is the service running?'
      : e.message;
    res.status(503).json({ error: msg });
  }
});

// ── SABnzbd ───────────────────────────────────────────────────────────────────

let _sabPathCache = null;

async function getSabPath(baseUrl, apikey) {
  if (_sabPathCache) return _sabPathCache;
  const config = loadConfig();
  if (config.sabnzbd?.sabPath) { _sabPathCache = config.sabnzbd.sabPath; return _sabPathCache; }
  const detected = await detectSabPath(baseUrl, apikey);
  if (detected) {
    _sabPathCache = detected;
    // Persist it so future server restarts don't re-probe
    const fresh = loadConfig();
    fresh.sabnzbd = { ...fresh.sabnzbd, sabPath: detected };
    saveConfig(fresh);
  }
  return detected;
}

async function sabRequest(params) {
  const config = loadConfig();
  const { url, apikey } = config.sabnzbd || {};
  if (!url || !apikey) throw Object.assign(new Error('SABnzbd not configured'), { status: 503 });
  const sabPath = await getSabPath(url, apikey);
  if (!sabPath) throw Object.assign(new Error('Cannot reach SABnzbd'), { status: 503 });
  const r = await axios.get(`${url}${sabPath}`, {
    params: { output: 'json', apikey, ...params },
    timeout: 10000,
  });
  return r.data;
}

app.get('/api/sabnzbd/queue', async (req, res) => {
  try { res.json(await sabRequest({ mode: 'queue' })); }
  catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sabnzbd/history', async (req, res) => {
  try { res.json(await sabRequest({ mode: 'history', limit: 15 })); }
  catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/sabnzbd/action', async (req, res) => {
  const { mode, nzo_id, name, value } = req.body;
  try {
    let params;
    if (nzo_id && (mode === 'pause' || mode === 'resume')) {
      // Per-item pause/resume uses mode=queue&name=pause/resume&value=<id>
      params = { mode: 'queue', name: mode, value: nzo_id };
    } else {
      params = { mode };
      if (name)  params.name  = name;
      if (value) params.value = value;
      if (nzo_id && !value) params.value = nzo_id;
    }
    res.json(await sabRequest(params));
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// ── Sonarr ────────────────────────────────────────────────────────────────────

function sonarrHeaders() {
  const config = loadConfig();
  const { url, apikey } = config.sonarr || {};
  if (!url || !apikey) throw Object.assign(new Error('Sonarr not configured'), { status: 503 });
  return { baseUrl: url, headers: { 'X-Api-Key': apikey } };
}

app.get('/api/sonarr/series', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/series`, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/series/:id/episodes', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/episode`, {
      headers,
      params: { seriesId: req.params.id },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/sonarr/command', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/command`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/command/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/command/${req.params.id}`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Interactive release search for a specific episode.
// Tries Sonarr first; if no results, falls back to a direct NZBHydra search.
app.get('/api/sonarr/release', async (req, res) => {
  const { episodeId, seriesTitle, season, episode } = req.query;
  try {
    // 1. Ask Sonarr (it queries all its configured indexers)
    const { baseUrl, headers } = sonarrHeaders();
    const sonarrRes = await axios.get(`${baseUrl}/api/v3/release`, {
      headers,
      params: { episodeId },
      timeout: 60000,
    });
    const sonarrResults = (sonarrRes.data || []).map(r => ({ ...r, _source: 'sonarr' }));

    if (sonarrResults.length > 0) {
      return res.json(sonarrResults);
    }

    // 2. Fallback: direct NZBHydra search if Sonarr found nothing
    const config = loadConfig();
    const { url: hydraUrl, apikey: hydraKey } = config.nzbhydra || {};
    if (!hydraUrl || !hydraKey || !seriesTitle) {
      return res.json([]); // nothing more we can do
    }

    const sn = String(season || '').padStart(2, '0');
    const ep = String(episode || '').padStart(2, '0');
    const q  = `${seriesTitle} S${sn}E${ep}`;

    const hydraRes = await axios.get(`${hydraUrl}/api`, {
      params: { t: 'search', q, o: 'json', apikey: hydraKey },
      timeout: 30000,
    });
    const rawItems = hydraRes.data?.channel?.item || [];
    const items = (Array.isArray(rawItems) ? rawItems : [rawItems]);

    const hydraResults = items.map(item => {
      const attrs = {};
      const rawAttrs = item['newznab:attr'] || item['attr'] || [];
      (Array.isArray(rawAttrs) ? rawAttrs : [rawAttrs]).forEach(a => {
        const n = a?.['@attributes'] || a;
        if (n?.name) attrs[n.name] = n.value;
      });
      const encUrl = item.enclosure?.['@attributes']?.url || item.enclosure?.url || item.link;
      const sizeBytes = parseInt(attrs.size || item.size || item.enclosure?.['@attributes']?.length || 0);
      const pubDate = item.pubDate ? new Date(item.pubDate) : null;
      const ageHours = pubDate ? (Date.now() - pubDate.getTime()) / 3600000 : null;
      return {
        guid:       item.guid?.['#text'] || item.guid || item.link,
        title:      item.title || '(no title)',
        indexer:    attrs.indexer || attrs.site || 'NZBHydra',
        size:       sizeBytes,
        ageHours,
        protocol:   'usenet',
        approved:   true,
        rejections: [],
        quality:    { quality: { name: 'Unknown' } },
        // For NZBHydra-direct results we send the NZB URL to SABnzbd ourselves
        _source:    'nzbhydra',
        _nzbUrl:    encUrl,
      };
    }).filter(r => r._nzbUrl);

    res.json(hydraResults);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Grab a specific release
app.post('/api/sonarr/release', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/release`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Delete an episode file from disk
app.delete('/api/sonarr/episodefile/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    await axios.delete(`${baseUrl}/api/v3/episodefile/${req.params.id}`, { headers, timeout: 15000 });
    res.json({ success: true });
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data || e.message;
    res.status(e.response?.status || 503).json({ error: String(msg) });
  }
});

// Update episode monitored status
app.put('/api/sonarr/episode/monitor', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.put(`${baseUrl}/api/v3/episode/monitor`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/lookup', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/series/lookup`, {
      headers, params: { term: req.query.term }, timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/qualityprofiles', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/qualityprofile`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/rootfolders', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/rootfolder`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/sonarr/series', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/series`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.[0]?.errorMessage || e.message;
    res.status(e.response?.status || 503).json({ error: msg });
  }
});

app.delete('/api/sonarr/series/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const deleteFiles = req.query.deleteFiles === 'true';
    await axios.delete(`${baseUrl}/api/v3/series/${req.params.id}`, {
      headers,
      params: { deleteFiles, addImportListExclusion: false },
      timeout: 15000,
    });
    res.json({ success: true });
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    res.status(e.response?.status || 503).json({ error: String(msg) });
  }
});

// ── Radarr ────────────────────────────────────────────────────────────────────

function radarrHeaders() {
  const config = loadConfig();
  const { url, apikey } = config.radarr || {};
  if (!url || !apikey) throw Object.assign(new Error('Radarr not configured'), { status: 503 });
  return { baseUrl: url, headers: { 'X-Api-Key': apikey } };
}

app.get('/api/radarr/movies', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/movie`, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/radarr/command', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/command`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/lookup', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/movie/lookup`, {
      headers, params: { term: req.query.term }, timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/qualityprofiles', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/qualityprofile`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/rootfolders', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/rootfolder`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/radarr/movie', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/movie`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.[0]?.errorMessage || e.message;
    res.status(e.response?.status || 503).json({ error: msg });
  }
});

app.get('/api/nzbhydra/search', async (req, res) => {
  const config = loadConfig();
  const { url, apikey } = config.nzbhydra || {};
  if (!url || !apikey) return res.status(503).json({ error: 'NZBHydra not configured' });
  const { q, cat } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });
  try {
    const params = { t: 'search', q, o: 'json', apikey };
    if (cat) params.cat = cat;
    const r = await axios.get(`${url}/api`, { params, timeout: 30000 });
    const items = r.data?.channel?.item || [];
    const results = (Array.isArray(items) ? items : [items]).map(item => {
      const attrs = {};
      const rawAttrs = item['newznab:attr'] || item['attr'] || [];
      (Array.isArray(rawAttrs) ? rawAttrs : [rawAttrs]).forEach(a => {
        const n = a?.['@attributes'] || a;
        if (n?.name) attrs[n.name] = n.value;
      });
      const encUrl = item.enclosure?.['@attributes']?.url || item.enclosure?.url || item.link;
      const sizeBytes = parseInt(attrs.size || item.size || item.enclosure?.['@attributes']?.length || 0);
      return {
        title:    item.title || '(no title)',
        guid:     item.guid?.['#text'] || item.guid || item.link,
        link:     encUrl,
        size:     sizeBytes,
        pubDate:  item.pubDate,
        category: item.category,
        indexer:  attrs.indexer || attrs.site || '',
        grabs:    attrs.grabs || 0,
      };
    }).filter(r => r.link);
    res.json(results);
  } catch (e) { res.status(503).json({ error: e.message }); }
});

app.post('/api/sabnzbd/addurl', async (req, res) => {
  const { url: nzbUrl, name } = req.body;
  if (!nzbUrl) return res.status(400).json({ error: 'Missing url' });
  try {
    const params = { mode: 'addurl', name: nzbUrl };
    if (name) params.nzbname = name;
    res.json(await sabRequest(params));
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});



app.get('/api/nzbhydra/status', async (req, res) => {
  const config = loadConfig();
  const { url, apikey } = config.nzbhydra || {};
  if (!url || !apikey) return res.status(503).json({ error: 'NZBHydra not configured' });
  try {
    await axios.get(`${url}/api`, { params: { t: 'caps', o: 'json', apikey }, timeout: 10000 });
    res.json({ status: 'ok' });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

// ── Server-Sent Events ────────────────────────────────────────────────────────
// Browser clients subscribe here and receive push notifications when Sonarr
// (or Radarr) webhooks fire, triggering an immediate UI refresh.

const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Keep-alive ping every 25s to prevent proxy/browser timeouts
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  sseClients.add(res);
  req.on('close', () => { sseClients.delete(res); clearInterval(ping); });
});

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

// ── Sonarr webhook ────────────────────────────────────────────────────────────
// In Sonarr: Settings → Connect → + → Webhook
//   URL:    http://<this-server>/api/webhooks/sonarr
//   Method: POST
//   Events: On Download (Import), On Episode File Delete, On Rename

app.post('/api/webhooks/sonarr', (req, res) => {
  res.sendStatus(200);
  const { eventType, series, episodes } = req.body;
  if (!eventType || eventType === 'Test') return;
  console.log(`[Sonarr webhook] ${eventType} — series: ${series?.title}`);
  broadcast('sonarr', {
    eventType,
    seriesId:   series?.id   ?? null,
    seriesTitle: series?.title ?? null,
    episodeIds: (episodes ?? []).map(e => e.id),
  });
});

// ── Radarr webhook ────────────────────────────────────────────────────────────
// In Radarr: Settings → Connect → + → Webhook
//   URL:    http://<this-server>/api/webhooks/radarr
//   Method: POST
//   Events: On Download (Import), On Movie File Delete

app.post('/api/webhooks/radarr', (req, res) => {
  res.sendStatus(200);
  const { eventType, movie } = req.body;
  if (!eventType || eventType === 'Test') return;
  console.log(`[Radarr webhook] ${eventType} — movie: ${movie?.title}`);
  broadcast('radarr', {
    eventType,
    movieId:    movie?.id    ?? null,
    movieTitle: movie?.title ?? null,
  });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Run `npm run build` first, or use `npm run dev` for development.');
  }
});

app.listen(PORT, () => {
  console.log(`✅  ArrView API running on http://localhost:${PORT}`);
  console.log(`    Sonarr webhook URL: http://localhost:${PORT}/api/webhooks/sonarr`);
  console.log(`    Radarr webhook URL: http://localhost:${PORT}/api/webhooks/radarr`);
});
