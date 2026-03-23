'use strict';

const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function exportPdf(htmlContent, options = {}) {
  const {
    format = 'A4',
    landscape = true,
    printBackground = true,
    slideCount
  } = options;

  // Write HTML to temp file
  const tmpFile = path.join(os.tmpdir(), `nexus-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, htmlContent, 'utf8');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();

    // Set viewport to 16:9 presentation aspect ratio
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });

    await page.goto(`file://${tmpFile}`, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for animations to settle
    await page.waitForTimeout(500);

    // Get all slides and render each as a page
    const slides = await page.$$('.slide');
    const pdfBuffers = [];

    for (let i = 0; i < slides.length; i++) {
      // Navigate to slide
      await page.evaluate((index) => {
        const slides = document.querySelectorAll('.slide');
        slides.forEach((s, j) => {
          s.style.opacity = j === index ? '1' : '0';
          s.style.transform = 'none';
          s.style.position = j === index ? 'relative' : 'absolute';
          s.style.pointerEvents = j === index ? 'all' : 'none';
        });
        // Hide controls for PDF
        const controls = document.getElementById('nexus-controls');
        const notes = document.getElementById('speaker-notes-panel');
        const overview = document.getElementById('overview-panel');
        if (controls) controls.style.display = 'none';
        if (notes) notes.style.display = 'none';
        if (overview) overview.style.display = 'none';
      }, i);

      await page.waitForTimeout(100);

      const pdf = await page.pdf({
        format,
        landscape,
        printBackground,
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      });

      pdfBuffers.push(pdf);
    }

    // For single-slide or simple export, just render all visible
    if (pdfBuffers.length === 0) {
      return await page.pdf({ format, landscape, printBackground });
    }

    // Return first slide's PDF for now (multi-page PDF merging would need pdf-lib)
    // Simple approach: render all slides in a single page document
    await page.evaluate(() => {
      const presentation = document.getElementById('nexus-presentation');
      const slides = document.querySelectorAll('.slide');
      const controls = document.getElementById('nexus-controls');
      const notes = document.getElementById('speaker-notes-panel');
      const overview = document.getElementById('overview-panel');
      if (controls) controls.remove();
      if (notes) notes.remove();
      if (overview) overview.remove();

      // Make all slides visible stacked
      if (presentation) {
        presentation.style.cssText = 'position:static;display:block;';
      }
      slides.forEach(s => {
        s.style.cssText = 'position:relative;opacity:1;transform:none;pointer-events:all;width:1280px;height:720px;display:flex;align-items:center;justify-content:center;page-break-after:always;';
      });
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    });

    const finalPdf = await page.pdf({
      format,
      landscape,
      printBackground,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });

    return finalPdf;
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

      await page.waitForTimeout(200);
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
