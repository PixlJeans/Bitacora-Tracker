// Vite copies the pdf.js worker into the build and returns its URL.
// The "legacy" pdf.js build is used: it includes polyfills for old Safari (Macs without macOS 14.4+).
// @ts-ignore - Vite ?url suffix
import url from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
export const workerSrc: string = url;
