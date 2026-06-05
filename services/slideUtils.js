'use strict';

/**
 * Parse individual slide elements from presentation HTML.
 * Returns [{start, end, html}] — absolute positions in the original string.
 * Handles nested divs via depth counting.
 * Only searches before the glowwee framework marker.
 */
function parseSlidesFromHtml(html) {
  // Current GLOWWEE marker, with backwards-compat for the legacy SLIDESIQ marker.
  const newIdx = html.indexOf('<!-- GLOWWEE:FRAMEWORK:START -->');
  const frameworkIdx = newIdx !== -1 ? newIdx : html.indexOf('<!-- SLIDESIQ:FRAMEWORK:START -->');
  const body = frameworkIdx > 0 ? html.slice(0, frameworkIdx) : html;

  const slides = [];
  let pos = 0;

  while (pos < body.length) {
    const divStart = body.indexOf('<div', pos);
    if (divStart === -1) break;

    const tagClose = body.indexOf('>', divStart);
    if (tagClose === -1) break;

    const openTag = body.slice(divStart, tagClose + 1);

    // Match class="slide" or class="slide active" — NOT class="slide-content" etc.
    if (/class="slide(?:\s[^"]*)?"/.test(openTag)) {
      let depth  = 1;
      let cursor = tagClose + 1;

      while (cursor < body.length && depth > 0) {
        const nextOpen  = body.indexOf('<div',  cursor);
        const nextClose = body.indexOf('</div>', cursor);
        if (nextClose === -1) break;

        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          cursor = nextOpen + 4;
        } else {
          depth--;
          cursor = nextClose + 6;
        }
      }

      if (depth === 0) {
        slides.push({ start: divStart, end: cursor, html: body.slice(divStart, cursor) });
        pos = cursor;
        continue;
      }
    }

    pos = divStart + 4;
  }

  return slides;
}

function replaceSlideInHtml(html, slideIndex, newSlideHtml) {
  const slides = parseSlidesFromHtml(html);
  if (slideIndex < 0 || slideIndex >= slides.length) return html;
  const { start, end } = slides[slideIndex];
  return html.slice(0, start) + newSlideHtml + html.slice(end);
}

function insertSlideInHtml(html, afterIndex, newSlideHtml) {
  const slides = parseSlidesFromHtml(html);
  if (slides.length === 0) return html;
  const idx     = Math.min(Math.max(afterIndex, -1), slides.length - 1);
  const { end } = idx < 0 ? { end: slides[0].start } : slides[idx];
  const sep     = '\n\n    ';
  return idx < 0
    ? html.slice(0, slides[0].start) + newSlideHtml + sep + html.slice(slides[0].start)
    : html.slice(0, end) + sep + newSlideHtml + html.slice(end);
}

function deleteSlideInHtml(html, slideIndex) {
  const slides = parseSlidesFromHtml(html);
  if (slides.length <= 1) return html;
  if (slideIndex < 0 || slideIndex >= slides.length) return html;
  const { start, end } = slides[slideIndex];
  return html.slice(0, start).trimEnd() + '\n\n    ' + html.slice(end).trimStart();
}

/**
 * Extract user CSS (excludes framework styles) from presentation HTML.
 * Limited to 3000 chars for use as AI context.
 */
function extractCssFromHtml(html) {
  const styleMatches = html.match(
    /<style(?![^>]*id="nexus-engine-styles")[^>]*>([\s\S]*?)<\/style>/gi
  ) || [];
  return styleMatches
    .map(s => s.replace(/<\/?style[^>]*>/gi, '').trim())
    .join('\n')
    .substring(0, 3000);
}

module.exports = { parseSlidesFromHtml, replaceSlideInHtml, insertSlideInHtml, deleteSlideInHtml, extractCssFromHtml };
