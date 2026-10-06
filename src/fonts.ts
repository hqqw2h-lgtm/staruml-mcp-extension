/*
 * Copyright (c) 2026 Ezra Brilliant Konterliem
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*
 * StarUML maps its diagram fonts to bundled files through @font-face rules
 * (FontManager.addFontToStyle, engine/font-manager.js in 7.1.1: "Arial" is
 * Liberation Sans), which the browser loads on first use. Text measured
 * before that is measured in a fallback face, so the first diagram built in
 * a session got other label widths, and another layout, than the same
 * build a minute later. Loading the faces before the server listens makes
 * every measurement the same.
 */

/** The faces diagram text is drawn in: StarUML's default font, plain, bold and italic. */
export const DIAGRAM_FACES = [
  "13px Arial",
  "bold 13px Arial",
  "italic 13px Arial",
];

/** Longest wait for the faces before serving anyway. */
export const FONT_WAIT_MS = 3000;

interface FontSet {
  load(font: string): Promise<unknown>;
}

/** Loads the diagram faces; answers false when there is nothing to load them with or they did not come in time. */
export async function loadDiagramFonts(
  fonts: FontSet | undefined = (
    globalThis as { document?: { fonts?: FontSet } }
  ).document?.fonts,
  wait = FONT_WAIT_MS,
): Promise<boolean> {
  if (!fonts) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), wait);
  });
  try {
    return await Promise.race([
      Promise.all(DIAGRAM_FACES.map((f) => fonts.load(f))).then(() => true),
      timeout,
    ]);
  } catch {
    // A face that fails to load is drawn in its fallback, as before.
    return false;
  } finally {
    clearTimeout(timer);
  }
}
