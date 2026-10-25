// Meaning-based search: turns text into vectors with llama.cpp's llama-server (the official
// llama.cpp project) and the bge-m3 model, which understands 100+ languages.
//
// botdot runs llama-server itself (a child process on a private local port) when it finds both:
//   - the binary: EMBED_SERVER_BIN, else `llama-server` on the PATH, else /app/llama-server (the
//     official llama.cpp Docker image, which botdot's own image is built on)
//   - the model: EMBED_MODEL_FILE, else /opt/models/bge-m3-q8_0.gguf (in the image), else
//     data/models/bge-m3-q8_0.gguf (downloaded from Settings → Memory)
// Or set EMBED_URL to use a llama-server (or any OpenAI-compatible /v1/embeddings server) you run
// yourself. Nothing here is platform-specific.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MODEL_NAME = 'bge-m3';
const MODEL_FILE = 'bge-m3-q8_0.gguf';
const MODEL_URL = 'https://huggingface.co/ggml-org/bge-m3-Q8_0-GGUF/resolve/main/bge-m3-q8_0.gguf';
const MODEL_BYTES = 635_000_000; // about 635 MB
const PORT = Number(process.env.EMBED_PORT) || 8089;
// llama-server's threads. Its own default is one per CPU it sees, which in an account's container is every CPU of the
// machine, more than the account's share: the threads then wait on each other and on the share's limit. Half the
// machine's CPUs, at most 4, leaves room for the bots' computers; embedding short texts needs no more.
const threads = (cpus = os.availableParallelism()) => Math.min(4, Math.max(1, Math.floor(cpus / 2)));

const llama = require('./which').create('llama-server', { envVar: 'EMBED_SERVER_BIN', candidates: ['/app/llama-server', '/opt/llama/llama-server', '/opt/homebrew/bin/llama-server', '/usr/local/bin/llama-server'] });

function create(dataDir) {
  const LOCAL_MODEL = path.join(dataDir, 'models', MODEL_FILE);
  const modelPath = () => [process.env.EMBED_MODEL_FILE, `/opt/models/${MODEL_FILE}`, LOCAL_MODEL].find((p) => p && fs.existsSync(p)) || null;
  const external = () => (process.env.EMBED_URL || '').replace(/\/+$/, '');

  let child = null;
  let childState = 'off'; // off | starting | ready | failed
  let childError = null;
  let wanted = false; // meaning search is on, so keep the server running
  let restarts = 0;

  const baseUrl = () => external() || `http://127.0.0.1:${PORT}`;

  async function healthy(timeoutMs = 1500) {
    try { return (await fetch(`${baseUrl()}/health`, { signal: AbortSignal.timeout(timeoutMs) })).ok; } catch { return false; }
  }

  // Start (or keep) our own llama-server. Resolves once it answers, or rejects.
  async function start() {
    if (external()) return;
    if (child && childState === 'ready') return;
    if (child && childState === 'starting') return waitReady();
    // One left over from an earlier start (botdot was stopped abruptly)? Use it.
    if (!child && (await healthy(800))) { childState = 'ready'; childError = null; return; }
    const bin = await llama.refresh();
    const model = modelPath();
    if (!bin) throw new Error('llama-server (llama.cpp) is not installed here');
    if (!model) throw new Error('The bge-m3 model file is not downloaded yet');
    childState = 'starting';
    childError = null;
    // Embeddings only; the whole text in one batch (bge-m3 reads up to 8,192 tokens).
    const args = ['-m', model, '--embedding', '--host', '127.0.0.1', '--port', String(PORT), '-c', '8192', '-b', '8192', '-ub', '8192', '--parallel', '1', '-t', String(threads()), '--log-disable'];
    child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, LD_LIBRARY_PATH: [path.dirname(bin), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-2000); });
    child.on('exit', (code) => {
      child = null;
      if (childState !== 'off') {
        childState = 'failed';
        childError = `llama-server stopped (exit ${code}). ${stderr.split('\n').filter(Boolean).slice(-2).join(' ')}`.trim();
        // Bring it back if meaning search is still on (a few times, then give up until the next change).
        if (wanted && restarts++ < 3) setTimeout(() => start().catch(() => {}), 5000);
      }
    });
    return waitReady();
  }

  async function waitReady() {
    const until = Date.now() + 120_000; // loading the model takes a few seconds
    while (Date.now() < until) {
      if (childState === 'failed') throw new Error(childError || 'llama-server failed to start');
      if (await healthy(1000)) { childState = 'ready'; restarts = 0; return; }
      await new Promise((r) => setTimeout(r, 500));
    }
    childState = 'failed';
    childError = 'llama-server did not become ready within 2 minutes';
    throw new Error(childError);
  }

  function stop() {
    wanted = false;
    childState = 'off';
    if (child) { try { child.kill('SIGTERM'); } catch { /* gone */ } child = null; }
  }
  // Take llama-server down with botdot, however it stops.
  const killChild = () => { if (child) try { child.kill('SIGTERM'); } catch { /* gone */ } };
  process.on('exit', killChild);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { killChild(); process.exit(0); });

  // Keep the server in line with the setting (called when meaning search is switched on or off).
  function want(on) {
    if (on) { wanted = true; return start(); }
    stop();
    return Promise.resolve();
  }

  // Normalised vectors for these texts (OpenAI-compatible /v1/embeddings).
  async function embed(texts, timeoutMs = 30_000) {
    if (wanted && !external() && childState !== 'ready') await start();
    const res = await fetch(`${baseUrl()}/v1/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts, model: MODEL_NAME }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(d.data)) throw new Error(d.error?.message || d.error || `llama-server answered ${res.status}`);
    return d.data.sort((a, b) => a.index - b.index).map((x) => {
      const f = Float32Array.from(x.embedding);
      let n = 0; for (const v of f) n += v * v; n = Math.sqrt(n) || 1;
      for (let i = 0; i < f.length; i++) f[i] /= n;
      return f;
    });
  }

  // Download the model into data/models (only when the owner clicks it). Streams to a temp file.
  let downloading = null; // { bytes, total }
  async function download() {
    if (downloading || modelPath()) return;
    downloading = { bytes: 0, total: MODEL_BYTES };
    const tmp = `${LOCAL_MODEL}.part`;
    try {
      fs.mkdirSync(path.dirname(LOCAL_MODEL), { recursive: true });
      const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(60 * 60_000) });
      if (!res.ok || !res.body) throw new Error(`the download answered ${res.status}`);
      downloading.total = Number(res.headers.get('content-length')) || MODEL_BYTES;
      const out = fs.createWriteStream(tmp);
      for await (const chunk of res.body) {
        downloading.bytes += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
      if (fs.statSync(tmp).size < 100_000_000) throw new Error('the downloaded file is too small');
      fs.renameSync(tmp, LOCAL_MODEL);
      childError = null;
      if (wanted) start().catch(() => {}); // meaning search was already on: start using it
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      childError = `Download failed: ${e.message}`;
    } finally { downloading = null; }
  }

  async function status() {
    const ext = external();
    return {
      model: MODEL_NAME,
      server: ext ? 'external' : 'built-in',
      address: baseUrl(),
      binary: ext ? null : llama.get(),
      modelFile: ext ? null : modelPath(),
      modelUrl: MODEL_URL,
      modelBytes: MODEL_BYTES,
      state: ext ? ((await healthy()) ? 'ready' : 'unreachable') : childState,
      error: childError,
      downloading,
    };
  }

  // Ready to embed? While meaning search is on, (re)start our server if it isn't running (at most
  // once a minute after a failure).
  let lastTry = 0;
  async function ready() {
    if (external()) return healthy();
    if (childState === 'ready') return true;
    if (wanted && childState !== 'starting' && Date.now() - lastTry > (childState === 'failed' ? 60_000 : 0)) {
      lastTry = Date.now();
      start().catch(() => {});
    }
    return false;
  }

  return { embed, want, stop, status, download, ready, MODEL_NAME };
}

module.exports = { create, threads, MODEL_NAME, MODEL_FILE, MODEL_URL };
