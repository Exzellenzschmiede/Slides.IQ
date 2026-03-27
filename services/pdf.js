'use strict';

const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function exportPdf(htmlContent, options = {}) {
  const { printBackground = true } = options;

  const tmpFile = path.join(os.tmpdir(), `nexus-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, htmlContent, 'utf8');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    // Step 1: Load presentation, extract slides + styles via DOM
    const extractPage = await browser.newPage();
    await extractPage.setViewport({ width: 1280, height: 720 });
    await extractPage.goto(`file://${tmpFile}`, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 300));

    const { slidesHtml, styles } = await extractPage.evaluate(() => {
      const slideEls = document.querySelectorAll('#nexus-presentation .slide');
      const styleEls = document.querySelectorAll('style');
      return {
        slidesHtml: Array.from(slideEls).map(s => s.outerHTML),
        styles: Array.from(styleEls).map(s => s.textContent).join('\n'),
      };
    });
    await extractPage.close();

    if (slidesHtml.length === 0) throw new Error('Keine Folien gefunden');

    // Step 2: Build clean print document — one .slide-page per slide, no framework JS
    const printDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${styles}</style>
<style>
  @page { size: 1280px 720px; margin: 0; }
  /* Override framework body styles (display:flex, overflow:hidden) */
  html, body {
    margin: 0 !important; padding: 0 !important;
    display: block !important; overflow: visible !important;
    width: 1280px !important; height: auto !important;
  }
  .slide-page {
    width: 1280px; height: 720px;
    position: relative; overflow: hidden;
    page-break-after: always; break-after: page;
  }
  .slide-page:last-child { page-break-after: avoid; break-after: avoid; }
  .slide-page .slide {
    position: absolute !important; inset: 0 !important;
    opacity: 1 !important; transform: none !important;
    transition: none !important;
    width: 1280px !important; height: 720px !important;
  }
  #nexus-controls, #speaker-notes-panel, #overview-panel { display: none !important; }
</style>
</head>
<body>
${slidesHtml.map(s => `<div class="slide-page">${s}</div>`).join('\n')}
</body>
</html>`;

    // Step 3: Render print document to PDF
    const printPage = await browser.newPage();
    await printPage.setContent(printDoc, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 300));

    const pdf = await printPage.pdf({
      width: '1280px',
      height: '720px',
      printBackground,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    return pdf;
  } finally {
    await browser.close();
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function exportSlideImages(htmlContent) {
  const tmpFile = path.join(os.tmpdir(), `nexus-img-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, htmlContent, 'utf8');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const images = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
    await page.goto(`file://${tmpFile}`, { waitUntil: 'networkidle0', timeout: 30000 });

    const slideCount = await page.$$eval('.slide', s => s.length);

    // Hide controls
    await page.evaluate(() => {
      ['nexus-controls','speaker-notes-panel','overview-panel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    });

    for (let i = 0; i < slideCount; i++) {
      await page.evaluate((index) => {
        document.querySelectorAll('.slide').forEach((s, j) => {
          s.style.opacity = j === index ? '1' : '0';
          s.style.position = j === index ? 'fixed' : 'absolute';
          s.style.transform = 'none';
        });
      }, i);

      await new Promise(r => setTimeout(r, 200));
      const screenshot = await page.screenshot({ type: 'png', fullPage: false });
      images.push({ index: i, data: screenshot.toString('base64'), mimeType: 'image/png' });
    }
  } finally {
    await browser.close();
    try { fs.unlinkSync(tmpFile); } catch {}
  }

  return images;
}

module.exports = { exportPdf, exportSlideImages };
