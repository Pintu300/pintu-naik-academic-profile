/* Optional browser QA. Requires Firefox and geckodriver on PATH; no npm packages. */
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { spawn, spawnSync } = require("node:child_process");
const { randomBytes, createHash } = require("node:crypto");
const { createServer } = require("../backend/server");
const { pages } = require("./site-metadata");
const root = path.resolve(__dirname, "..");
const elementKey = "element-6066-11e4-a52e-4f735466cecf";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  const output = path.join(root, "artifacts", "browser");
  await fs.mkdir(output, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "academic-browser-"));
  const dataDir = path.join(temporary, "data");
  const realData = path.join(root, "backend", "data");
  await fs.cp(realData, dataDir, { recursive: true });
  const fingerprints = async () => Object.fromEntries(await Promise.all((await fs.readdir(realData)).filter((file) => file.endsWith(".json")).map(async (file) => [file, createHash("sha256").update(await fs.readFile(path.join(realData, file))).digest("hex")])));
  const original = await fingerprints();
  const password = randomBytes(24).toString("hex");
  let adminTime = Date.now();
  const server = createServer({ adminPassword: password, dataDir, now: () => adminTime });
  let driver;
  let sessionId;
  let driverBase;
  const report = { environment: "Local headless browser. Viewport emulation, not physical phones. Resource samples are unthrottled and can include decoded-image cache reuse.", browser: "Firefox", checks: [], pages: [], screenshots: [], metrics: [], productionDataUnchanged: false };
  let driverLogs = "";
  let socket;
  let bidi;
  let browsingContext;
  const wire = async (method, endpoint, body) => {
    const response = await fetch(`${driverBase}${endpoint}`, {
      method, headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000)
    });
    const payload = await response.json();
    if (!response.ok || payload.value?.error) throw new Error(`${payload.value?.error || response.status}: ${payload.value?.message || "Browser command failed"}`);
    return payload.value;
  };
  const command = (method, suffix, body) => wire(method, `/session/${sessionId}${suffix}`, body);
  const js = (script, args = []) => command("POST", "/execute/sync", { script, args });
  const waitFor = async (script, description) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await js(script)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${description}`);
  };
  const find = async (selector) => (await command("POST", "/element", { using: "css selector", value: selector }))[elementKey];
  const click = async (selector) => command("POST", `/element/${await find(selector)}/click`, {});
  const fill = async (selector, value) => {
    const id = await find(selector);
    await command("POST", `/element/${id}/clear`, {});
    await command("POST", `/element/${id}/value`, { text: value });
  };
  const navigate = (url) => command("POST", "/url", { url });
  const screenshot = async (name) => {
    const data = await command("GET", "/screenshot");
    const file = `${name}.png`;
    await fs.writeFile(path.join(output, file), Buffer.from(data, "base64"));
    report.screenshots.push(file);
  };
  const check = async (name, callback) => {
    try {
      await callback();
      report.checks.push({ name, status: "passed" });
      console.log(`PASS ${name}`);
    } catch (error) {
      report.checks.push({ name, status: "failed", error: error.message });
      console.error(`FAIL ${name}: ${error.message}`);
      await screenshot(`failure-${report.checks.length}`).catch(() => {});
    }
  };
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const reservation = net.createServer();
    await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
    const driverPort = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    driverBase = `http://127.0.0.1:${driverPort}`;
    driver = spawn(process.env.GECKODRIVER || "geckodriver", ["--host", "127.0.0.1", "--port", String(driverPort)], { stdio: ["ignore", "pipe", "pipe"] });
    driver.on("error", (error) => { driverLogs += error.message; });
    for (const stream of [driver.stdout, driver.stderr]) stream.on("data", (chunk) => { driverLogs = (driverLogs + chunk).slice(-8000); });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { await wire("GET", "/status"); ready = true; break; } catch { await delay(100); }
    }
    if (!ready) throw new Error(`Firefox driver did not start: ${driverLogs.slice(-1500)}`);
    const session = await wire("POST", "/session", { capabilities: { alwaysMatch: {
      browserName: "firefox", webSocketUrl: true, pageLoadStrategy: "eager", "moz:firefoxOptions": {
        ...(process.env.FIREFOX_BINARY ? { binary: process.env.FIREFOX_BINARY } : {}),
        args: ["-headless"], prefs: {
        "browser.shell.checkDefaultBrowser": false,
        "browser.download.folderList": 2,
        "browser.download.dir": output,
        "browser.download.useDownloadDir": true,
        "browser.helperApps.neverAsk.saveToDisk": "application/x-bibtex,application/json,text/plain"
      } }
    } } });
    sessionId = session.sessionId;
    report.browserVersion = session.capabilities.browserVersion;
    socket = new WebSocket(session.capabilities.webSocketUrl);
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    let messageId = 0;
    const pending = new Map();
    report.javascriptErrors = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.method === "log.entryAdded" && message.params.type === "javascript" && message.params.level === "error") {
        report.javascriptErrors.push({ text: message.params.text, source: message.params.source });
      }
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
      clearTimeout(handler.timeout);
      if (message.type === "error") handler.reject(new Error(`${message.error}: ${message.message}`));
      else handler.resolve(message.result);
    });
    bidi = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++messageId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Browser protocol timeout: ${method}`)); }, 15_000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
    browsingContext = (await bidi("browsingContext.getTree", { maxDepth: 0 })).contexts[0].context;
    await bidi("session.subscribe", { events: ["log.entryAdded"] });
    await bidi("script.addPreloadScript", { functionDeclaration: `() => {
      window.__qaMetrics = { lcpMs: null, cls: null };
      const supported = PerformanceObserver.supportedEntryTypes || [];
      if (supported.includes('largest-contentful-paint')) new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__qaMetrics.lcpMs = Math.round(entry.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      if (supported.includes('layout-shift')) {
        window.__qaMetrics.cls = 0;
        new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__qaMetrics.cls += entry.value; })
          .observe({ type: 'layout-shift', buffered: true });
      }
    }` });
    const viewport = (width, height) => bidi("browsingContext.setViewport", { context: browsingContext, viewport: { width, height }, devicePixelRatio: 1 });

    await command("POST", "/timeouts", { implicit: 0, pageLoad: 30_000, script: 15_000 });
    console.log(`Firefox ${report.browserVersion} started with isolated website data.`);
    if (process.env.BROWSER_QA_FOCUS === "visitors") {
      await check("visitor panel shows live totals for its configured reporting date", async () => {
        await viewport(1280, 900);
        await navigate(`${base}/index.html`);
        await waitFor("return document.querySelector('[data-visitor-total]').textContent !== '—'", "live visitor counts");
        const state = await js(`const panel=document.querySelector('[data-visitor-stats]');return {
          configuredDate:panel.dataset.startDate,
          period:panel.querySelector('[data-visitor-period]').textContent,
          total:panel.querySelector('[data-visitor-total]').textContent
        };`);
        assert.equal(state.configuredDate, "2026-11-10");
        assert.equal(state.period, `Unique visitors since ${state.configuredDate}`);
        report.visitorPanel = state;
        await js("document.querySelector('[data-visitor-stats]').scrollIntoView({block:'center', behavior:'instant'})");
        await waitFor("const panel=document.querySelector('[data-visitor-stats]');const box=panel.getBoundingClientRect();return box.top < innerHeight && box.bottom > 0 && Number(getComputedStyle(panel.closest('section')).opacity) > 0.99", "visitor panel visible");
        await screenshot("visitor-date");
      });
      assert.equal(report.checks.filter((entry) => entry.status === "failed").length, 0, "Visitor panel verification failed");
      return;
    }
    const sizes = [{ name: "desktop", width: 1440, height: 1000 }, { name: "tablet", width: 768, height: 1024 }, { name: "mobile", width: 390, height: 844 }, { name: "small-mobile", width: 320, height: 700 }];
    for (const size of sizes) {
      await viewport(size.width, size.height);
      for (const filename of Object.keys(pages)) {
        await check(`${size.name}: ${filename} layout and content`, async () => {
          await navigate(`${base}/${filename}`);
          await waitFor("return document.querySelectorAll('main .academic-record, main .education-entry, main .research-interest-card, main .achievement-gallery__item').length > 0 || document.querySelector('[data-projects-list] .academic-empty-state') !== null;", "page data");
          await waitFor("return [...document.images].filter(i => i.loading !== 'lazy').every(i => i.complete)", "visible images");
          const state = await js(`return {
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            title: document.title, error: !!document.querySelector('aside.content-status'),
            brokenImages: [...document.images].filter(i => i.complete && i.currentSrc && !i.naturalWidth && !i.hidden).map(i => i.getAttribute('src')),
            heading: document.querySelector('h1')?.textContent,
            navigation: !!document.querySelector('.academic-nav__toggle')
          };`);
          assert.equal(state.width, size.width, "Actual viewport must match the requested responsive size");
          assert.ok(state.scrollWidth <= state.width + 1, `Horizontal overflow: ${state.scrollWidth}px into ${state.width}px`);
          assert.equal(state.error, false, "Content loading error is visible");
          assert.deepEqual(state.brokenImages, [], "Broken images");
          assert.ok(state.heading?.trim());
          report.pages.push({ size: size.name, filename, ...state });
          if (["index.html", "cv.html", "publications.html"].includes(filename) && ["desktop", "mobile"].includes(size.name)) await screenshot(`${size.name}-${filename.replace('.html', '')}`);
          if (filename === "index.html" && ["desktop", "mobile"].includes(size.name)) {
            report.metrics.push(await js(`const nav=performance.getEntriesByType('navigation')[0]; return {
              viewport: innerWidth, ...window.__qaMetrics, domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
              paints: performance.getEntriesByType('paint').map(e=>({name:e.name,ms:Math.round(e.startTime)})),
              transferBytes: performance.getEntriesByType('resource').reduce((n,e)=>n+e.transferSize,0),
              resources: performance.getEntriesByType('resource').filter(e=>e.name.startsWith(location.origin)).map(e=>({path:new URL(e.name).pathname,bytes:e.transferSize,durationMs:Math.round(e.duration)}))
            };`));
          }
        });
      }
    }
    await check("mobile loading measurement with HTTP cache bypass", async () => {
      await viewport(390, 844);
      await bidi("network.setCacheBehavior", { cacheBehavior: "bypass" });
      await navigate(`${base}/index.html`);
      await waitFor("return document.querySelectorAll('[data-selected-publications] .academic-record').length > 0 && [...document.images].filter(i => i.loading !== 'lazy').every(i => i.complete)", "cold homepage");
      report.mobileLoadingSample = await js(`const nav=performance.getEntriesByType('navigation')[0]; return {
        viewport: innerWidth, domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        resourceTransferBytes: performance.getEntriesByType('resource').reduce((n,e)=>n+e.transferSize,0),
        metrics: window.__qaMetrics,
        imageRequests: performance.getEntriesByType('resource').filter(e=>e.name.includes('/assets/')).map(e=>({path:new URL(e.name).pathname,bytes:e.transferSize}))
      };`);
      await bidi("network.setCacheBehavior", { cacheBehavior: "default" });
    });
    const downloadAfter = async (before, pattern) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const names = await fs.readdir(output);
        const name = names.find((name) => !before.includes(name) && pattern.test(name));
        if (name) return fs.readFile(path.join(output, name), "utf8");
        await delay(100);
      }
      throw new Error("Expected browser download was not created");
    };
    await check("publication search, filters, shareable URLs, and citation downloads", async () => {
      await viewport(390, 844);
      await navigate(`${base}/publications.html`);
      await waitFor("return document.querySelector('[data-publication-controls]').disabled === false", "publication tools");
      await fill("[data-publication-query]", "maximum flow");
      await waitFor("return document.querySelectorAll('#publication-results .academic-record').length === 2", "keyword results");
      await click("[data-publication-type] option[value='journal']");
      await waitFor("return document.querySelectorAll('#publication-results .academic-record').length === 1", "type filter");
      const url = await command("GET", "/url");
      assert.ok(url.includes("q=maximum+flow") && url.includes("type=journal"));
      await navigate(url);
      await waitFor("return !document.querySelector('[data-publication-controls]').disabled && document.querySelectorAll('#publication-results .academic-record').length === 1", "restored filters");
      assert.equal(await js("return document.querySelector('[data-publication-query]').value"), "maximum flow");
      await js("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copiedText = text; } } })");
      await click("[data-publication-share]");
      await waitFor("return window.__copiedText === location.href", "copy filtered URL");
      await click("[data-cite]");
      assert.equal(await js("return document.querySelector('[data-citation-dialog]').open"), true);
      await click("[data-citation-format] option[value='bibtex']");
      assert.match(await js("return document.querySelector('[data-citation-text]').value"), /^@unpublished/);
      await click("[data-citation-copy]");
      await waitFor("return window.__copiedText.startsWith('@unpublished')", "copy citation");
      await js("navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied for fallback test'); }");
      await click("[data-citation-copy]");
      await waitFor("return document.querySelector('[data-citation-status]').textContent.includes('selected citation')", "clipboard fallback");
      assert.equal(await js("return document.activeElement === document.querySelector('[data-citation-text]')"), true);
      const before = await fs.readdir(output);
      await click("[data-citation-download]");
      assert.match(await downloadAfter(before, /\.bib$/), /note = \{Accepted/);
      await screenshot("mobile-citation");
      await click("[data-citation-close]");
      assert.equal(await js("return document.activeElement.matches('[data-cite]')"), true);
      const exportBefore = await fs.readdir(output);
      await click("[data-publication-export]");
      const exported = await downloadAfter(exportBefore, /\.bib$/);
      assert.equal((exported.match(/^@/gm) || []).length, 1);
      await click("[data-publication-reset]");
      await click("[data-publication-status] option[value='Submitted']");
      assert.equal(await js("return document.querySelectorAll('#publication-results .academic-record').length"), 2);
      await fill("[data-publication-query]", "no-such-publication");
      assert.equal(await js("return document.querySelector('[data-publication-empty]').hidden"), false);
      assert.equal(await js("return document.querySelector('[data-publication-export]').disabled"), true);
      await click("[data-publication-reset]");
      assert.equal(await js("return document.querySelectorAll('#publication-results .academic-record').length"), 7);
    });
    await check("mobile menu opens, navigates, and closes with Escape", async () => {
      await viewport(390, 844);
      await navigate(`${base}/index.html`);
      await click(".academic-nav__toggle");
      assert.equal(await js("return document.querySelector('.academic-nav__toggle').getAttribute('aria-expanded')"), "true");
      await click("#academic-menu a[href='research.html']");
      assert.ok((await command("GET", "/url")).endsWith("/research.html"));
      await click(".academic-nav__toggle");
      await js("document.querySelector('#academic-menu a').focus()");
      await command("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions: [{ type: "keyDown", value: "\uE00C" }, { type: "keyUp", value: "\uE00C" }] }] });
      assert.equal(await js("return document.querySelector('.academic-nav__toggle').getAttribute('aria-expanded')"), "false");
    });
    await check("gallery modal supports keyboard focus and Escape", async () => {
      await navigate(`${base}/achievements.html`);
      await waitFor("return !!document.querySelector('[data-achievement-index]')", "gallery cards");
      await click("[data-achievement-index]");
      assert.equal(await js("return document.querySelector('main').inert"), true);
      assert.equal(await js("return document.activeElement.matches('.achievement-detail__close')"), true);
      await command("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions: [{ type: "keyDown", value: "\uE004" }, { type: "keyUp", value: "\uE004" }] }] });
      assert.equal(await js("return !!document.activeElement.closest('[role=dialog]')"), true);
      await command("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions: [{ type: "keyDown", value: "\uE00C" }, { type: "keyUp", value: "\uE00C" }] }] });
      assert.equal(await js("return document.querySelector('[data-achievement-modal]').hidden && !document.querySelector('main').inert"), true);
    });
    await check("CV print button runs with fully loaded content", async () => {
      await navigate(`${base}/cv.html`);
      await waitFor("return document.querySelector('[data-print-cv]').disabled === false", "CV content");
      await js("window.print = () => { window.__printed = true; }");
      await click("[data-print-cv]");
      assert.equal(await js("return window.__printed"), true);
      const pdf = await command("POST", "/print", { background: true, page: { width: 21, height: 29.7 }, margin: { top: 1, bottom: 1, left: 1, right: 1 }, shrinkToFit: true });
      await fs.writeFile(path.join(output, "cv.pdf"), Buffer.from(pdf, "base64"));
      report.printedCv = "cv.pdf";
      const extracted = spawnSync("pdftotext", [path.join(output, "cv.pdf"), "-"], { encoding: "utf8" });
      if (!extracted.error) {
        assert.equal(extracted.status, 0, "PDF text extraction failed");
        const text = extracted.stdout.replace(/\s+/g, " ");
        for (const marker of ["Viterbi Decoder", "Programming", "Laboratory instruction", "High-Performance Computing"]) {
          assert.ok(text.includes(marker), `Printed CV is missing ${marker}`);
        }
        report.printTextValidation = "Publications, skills, teaching, and research interests confirmed in PDF.";
      } else report.printTextValidation = "Not checked: pdftotext is not installed.";
    });
    await check("admin login rejects wrong credentials and opens the editor on success", async () => {
      await navigate(`${base}/admin.html`);
      assert.ok((await command("GET", "/url")).endsWith("/login.html"));
      await fill("[name=username]", "admin");
      await fill("[name=password]", "incorrect-password");
      await click("[type=submit]");
      await waitFor("return document.querySelector('[data-login-status]').dataset.status === 'error'", "login rejection");
      await fill("[name=password]", password);
      await click("[type=submit]");
      await waitFor("return location.pathname === '/admin.html' && document.querySelector('[data-editor-fields]').disabled === false", "editor login");
      await screenshot("mobile-admin");
      for (const size of sizes) {
        await viewport(size.width, size.height);
        const dimensions = await js("return { width: innerWidth, scroll: document.documentElement.scrollWidth }");
        assert.equal(dimensions.width, size.width);
        assert.ok(dimensions.scroll <= dimensions.width + 1, `Admin overflows at ${size.width}px`);
      }
      await viewport(390, 844);
    });
    await check("admin project workflow on desktop and mobile", async () => {
      for (const width of [390, 1440]) {
      await viewport(width, 1000);
      await fs.writeFile(path.join(dataDir, "projects.json"), "[]\n");
      await navigate(`${base}/admin.html`);
      await waitFor("return document.querySelector('[data-editor-fields]').disabled === false", "fresh editor data");
      const section = "section[aria-labelledby='editor-projects']";
      const add = `${section} > button`;
      await click(add);
      await fill(`${section} [data-record-field=title]`, "Browser QA project A");
      await fill(`${section} [data-record-field=description]`, "Temporary browser test data.");
      await fill(`${section} [data-record-field=contribution]`, "Tested editing and persistence.");
      await fill(`${section} [data-record-field=stack]`, "CUDA, C++");
      await fill(`${section} [data-record-field=codeUrl]`, "https://example.com/code");
      await click(add);
      const entries = await command("POST", "/elements", { using: "css selector", value: `${section} [data-record]` });
      const last = entries[entries.length - 1][elementKey];
      const title = await command("POST", `/element/${last}/element`, { using: "css selector", value: "[data-record-field=title]" });
      await command("POST", `/element/${title[elementKey]}/value`, { text: "Browser QA project B" });
      const up = await command("POST", `/element/${last}/element`, { using: "css selector", value: "button[aria-label^='Move up']" });
      await command("POST", `/element/${up[elementKey]}/click`, {});
      assert.match(await js(`return document.querySelector(${JSON.stringify(section + ' [data-record] summary')}).textContent`), /project B/);
      await click(`${section} [data-record] button[aria-label^='Remove']`);
      assert.equal(await js(`return document.querySelectorAll(${JSON.stringify(section + ' [data-record]')}).length`), 1);
      await click(`${section} > button:last-child`);
      assert.equal(await js(`return document.querySelectorAll(${JSON.stringify(section + ' [data-record]')}).length`), 2);
      await click("[data-editor-form] > .editor-actions [type=submit]");
      await waitFor("return document.querySelector('[data-editor-status]').dataset.status === 'success'", "saving edited projects");
      const saved = JSON.parse(await fs.readFile(path.join(dataDir, "projects.json"), "utf8"));
      assert.deepEqual(saved.map((item) => item.title), ["Browser QA project B", "Browser QA project A"]);
      assert.equal(saved[1].contribution, "Tested editing and persistence.");
      await navigate(`${base}/projects.html`);
      await waitFor("return document.querySelectorAll('[data-projects-list] .academic-record').length === 2", "public project rendering");
      assert.match(await js("return document.querySelector('[data-projects-list]').textContent"), /Browser QA project A/);
      await navigate(`${base}/admin.html`);
      await waitFor("return document.querySelector('[data-editor-fields]').disabled === false", "reloading saved projects");
      assert.equal(await js(`return document.querySelectorAll(${JSON.stringify(section + ' [data-record]')}).length`), 2);
      }
    });
    await check("admin record search preserves hidden data and saved backup downloads", async () => {
      const selector = "[data-editor-search='projects']";
      await fill(selector, "project B");
      assert.equal(await js("return document.querySelectorAll(\"section[aria-labelledby='editor-projects'] [data-record]:not([hidden])\").length"), 1);
      await click("[data-editor-save]");
      await waitFor("return document.querySelector('[data-editor-status]').dataset.status === 'success'", "save filtered editor");
      const saved = JSON.parse(await fs.readFile(path.join(dataDir, "projects.json"), "utf8"));
      assert.equal(saved.length, 2, "Searching must not delete hidden records");
      await click("section[aria-labelledby='editor-projects'] [data-record]:not([hidden]) > summary");
      await fill("section[aria-labelledby='editor-projects'] [data-record]:not([hidden]) [data-record-field=title]", "Unsaved draft not in backup");
      assert.equal(await js("return document.querySelectorAll(\"section[aria-labelledby='editor-projects'] [data-record]:not([hidden])\").length"), 1, "Editing a matching record must not hide the active form");
      const before = await fs.readdir(output);
      await click("[data-editor-backup]");
      const backup = JSON.parse(await downloadAfter(before, /^academic-site-backup.*\.json$/));
      assert.deepEqual(backup.projects, saved);
      assert.equal(backup.csrfToken, undefined);
      assert.ok(!JSON.stringify(backup).includes("Unsaved draft not in backup"));
      await fill("section[aria-labelledby='editor-projects'] [data-record]:not([hidden]) [data-record-field=title]", "Browser QA project B");
      await click("[data-editor-save]");
      await waitFor("return document.querySelector('[data-editor-status]').dataset.status === 'success'", "restore draft after backup test");
      assert.equal(await js("return document.querySelectorAll('[data-editor-nav] a').length"), 11);
    });
    await check("project search supports shareable URLs and empty results", async () => {
      await navigate(`${base}/projects.html?q=persistence`);
      await waitFor("return !document.querySelector('[data-project-controls]').disabled", "project tools");
      assert.equal(await js("return document.querySelectorAll('[data-projects-list] .academic-record').length"), 1);
      assert.match(await js("return document.querySelector('[data-projects-list]').textContent"), /project A/);
      await click("[data-project-technology] option[value='CUDA']");
      assert.equal(await js("return document.querySelectorAll('[data-projects-list] .academic-record').length"), 1);
      await fill("[data-project-query]", "no-such-project");
      assert.match(await js("return document.querySelector('[data-projects-list]').textContent"), /No projects match/);
      await click("[data-project-reset]");
      assert.equal(await js("return document.querySelectorAll('[data-projects-list] .academic-record').length"), 2);
      await navigate(`${base}/admin.html`);
      await waitFor("return document.querySelector('[data-editor-fields]').disabled === false", "return to editor");
    });
    const restoreFixtures = path.join(output, "restore-fixtures");
    await fs.mkdir(restoreFixtures, { recursive: true });
    await check("backup files are validated and cancellation preserves editor content", async () => {
      const upload = async (filename, contents) => {
        const file = path.join(restoreFixtures, filename);
        await fs.writeFile(file, contents);
        await command("POST", `/element/${await find("[data-editor-restore]")}/value`, { text: file });
      };
      const nameBefore = await js("return document.querySelector('[name=\"profile.name\"]').value");
      await upload("invalid.json", "{invalid");
      await waitFor("return document.querySelector('[data-restore-status]').textContent.includes('valid JSON')", "invalid backup rejection");
      await upload("unsafe.json", JSON.stringify({ profile: {} }));
      await waitFor("return document.querySelector('[data-restore-status]').textContent.startsWith('Cannot restore:') && !document.querySelector('[data-restore-status]').textContent.includes('valid JSON')", "incomplete backup rejection");
      const files = (await fs.readdir(dataDir)).filter((name) => name.endsWith(".json"));
      const backup = Object.fromEntries(await Promise.all(files.map(async (name) => [name.replace(/\.json$/, ""), JSON.parse(await fs.readFile(path.join(dataDir, name), "utf8"))])));
      backup.profile.name = "Restored browser profile";
      backup.profile.customField = "Preserved imported metadata";
      const file = path.join(restoreFixtures, "restore.json");
      await fs.writeFile(file, JSON.stringify(backup));
      await command("POST", `/element/${await find("[data-editor-restore]")}/value`, { text: file });
      await waitFor("return !document.querySelector('[data-restore-preview]').hidden", "backup preview");
      assert.match(await js("return document.querySelector('[data-restore-summary]').textContent"), /Restored browser profile/);
      await click("[data-restore-cancel]");
      assert.equal(await js("return document.querySelector('[name=\"profile.name\"]').value"), nameBefore);
      assert.equal(await js("return document.querySelector('[data-restore-preview]').hidden"), true);
    });
    await check("backup restoration stages a draft and saves only on explicit submission", async () => {
      const file = path.join(restoreFixtures, "restore.json");
      const profileBefore = await fs.readFile(path.join(dataDir, "profile.json"), "utf8");
      await command("POST", `/element/${await find("[data-editor-restore]")}/value`, { text: file });
      await waitFor("return !document.querySelector('[data-restore-preview]').hidden", "backup preview again");
      await click("[data-restore-apply]");
      assert.equal(await js("return document.querySelector('[name=\"profile.name\"]').value"), "Restored browser profile");
      assert.equal(await fs.readFile(path.join(dataDir, "profile.json"), "utf8"), profileBefore);
      assert.equal(await js("return document.querySelectorAll('[data-editor-nav] a').length"), 11);
      const before = await fs.readdir(output);
      await click("[data-editor-draft]");
      const draft = JSON.parse(await downloadAfter(before, /^academic-site-draft.*\.json$/));
      assert.equal(draft.profile.name, "Restored browser profile");
      assert.equal(draft.profile.customField, "Preserved imported metadata");
      await click("[data-editor-save]");
      await waitFor("return document.querySelector('[data-editor-status]').dataset.status === 'success'", "save restored backup");
      const saved = JSON.parse(await fs.readFile(path.join(dataDir, "profile.json"), "utf8"));
      assert.equal(saved.name, draft.profile.name);
      assert.equal(saved.customField, draft.profile.customField);
      await fill("[name='profile.name']", "Second save after restore");
      await click("[data-editor-save]");
      await waitFor("return document.querySelector('[data-editor-status]').dataset.status === 'success'", "save with updated revision");
      assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, "profile.json"), "utf8")).name, "Second save after restore");
    });
    const renewSession = async () => {
      const status = await command("POST", "/execute/async", {
        script: "const done = arguments[arguments.length - 1]; fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'admin-editor'},body:JSON.stringify({username:'admin',password:arguments[0]})}).then(response => done(response.status)).catch(() => done(0));",
        args: [password]
      });
      assert.equal(status, 200);
    };
    await check("expired sessions preserve drafts and reconnect without reloading", async () => {
      await fill("[name='profile.name']", "Draft retained after session expiry");
      const beforeSave = await fs.readFile(path.join(dataDir, "profile.json"), "utf8");
      adminTime += 31 * 60 * 1000;
      await click("[data-editor-save]");
      await waitFor("return !document.querySelector('[data-editor-session]').hidden", "session recovery notice");
      assert.ok((await command("GET", "/url")).endsWith("/admin.html"));
      assert.equal(await js("return document.querySelector('[name=\"profile.name\"]').value"), "Draft retained after session expiry");
      assert.equal(await js("return document.querySelector('[data-editor-save]').disabled"), true);
      assert.equal(await fs.readFile(path.join(dataDir, "profile.json"), "utf8"), beforeSave);
      const before = await fs.readdir(output);
      await click("[data-editor-draft]");
      const draft = JSON.parse(await downloadAfter(before, /^academic-site-draft.*\.json$/));
      assert.equal(draft.profile.name, "Draft retained after session expiry");
      await renewSession();
      await click("[data-editor-reconnect]");
      await waitFor("return document.querySelector('[data-editor-session]').hidden && !document.querySelector('[data-editor-save]').disabled", "session reconnected");
      await click("[data-editor-save]");
      await waitFor("return document.querySelector('[data-editor-status]').dataset.status === 'success'", "save retained draft");
      assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, "profile.json"), "utf8")).name, draft.profile.name);
    });
    await check("reconnecting cannot bypass save-conflict protection", async () => {
      await fill("[name='profile.name']", "Older draft after second expiry");
      adminTime += 31 * 60 * 1000;
      await click("[data-editor-save]");
      await waitFor("return !document.querySelector('[data-editor-session]').hidden", "second session expiry");
      const file = path.join(dataDir, "profile.json");
      const profile = JSON.parse(await fs.readFile(file, "utf8"));
      await fs.writeFile(file, JSON.stringify({ ...profile, name: "Newer content during expiry" }));
      await renewSession();
      await click("[data-editor-reconnect]");
      await waitFor("return document.querySelector('[data-editor-session]').hidden", "reconnect after external change");
      assert.match(await js("return document.querySelector('[data-editor-status]').textContent"), /saved content changed/);
      await click("[data-editor-save]");
      await waitFor("return document.querySelector('[data-editor-status]').textContent.includes('Content changed')", "stale reconnected save rejected");
      assert.equal(JSON.parse(await fs.readFile(file, "utf8")).name, "Newer content during expiry");
    });
    await check("a stale editor cannot overwrite newer content and keeps its unsaved draft", async () => {
      const profileFile = path.join(dataDir, "profile.json");
      const current = JSON.parse(await fs.readFile(profileFile, "utf8"));
      await fs.writeFile(profileFile, JSON.stringify({ ...current, name: "Newer externally saved profile" }));
      await fill("[name='profile.name']", "Unsaved conflicting draft");
      await click("[data-editor-save]");
      await waitFor("return document.querySelector('[data-editor-status]').dataset.status === 'error'", "stale save rejection");
      assert.match(await js("return document.querySelector('[data-editor-status]').textContent"), /Content changed/);
      assert.equal(await js("return document.querySelector('[name=\"profile.name\"]').value"), "Unsaved conflicting draft");
      assert.equal(JSON.parse(await fs.readFile(profileFile, "utf8")).name, "Newer externally saved profile");
      const before = await fs.readdir(output);
      await click("[data-editor-draft]");
      const draft = JSON.parse(await downloadAfter(before, /^academic-site-draft.*\.json$/));
      assert.equal(draft.profile.name, "Unsaved conflicting draft");
    });
    await check("sign out invalidates access to the admin page", async () => {
      await waitFor("return document.querySelector('[data-editor-fields]').disabled === false", "editor before logout");
      await click("[data-logout]");
      await waitFor("return location.pathname === '/login.html'", "logout");
      await navigate(`${base}/admin.html`);
      assert.ok((await command("GET", "/url")).endsWith("/login.html"));
    });
  } finally {
    if (socket) socket.close();
    if (sessionId) await command("DELETE", "").catch(() => {});
    if (driver) driver.kill("SIGTERM");
    if (server.listening) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    report.productionDataUnchanged = JSON.stringify(await fingerprints()) === JSON.stringify(original);
    await fs.rm(temporary, { recursive: true, force: true });
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`Browser report: ${path.join(output, 'report.json')}`);
    assert.equal(report.productionDataUnchanged, true, "Actual website data changed during browser testing");
  }
  assert.deepEqual(report.javascriptErrors, [], "Unexpected JavaScript errors in the browser");
  assert.equal(report.checks.filter((check) => check.status === "failed").length, 0, "Some browser checks failed; inspect artifacts/browser/report.json");
};
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
