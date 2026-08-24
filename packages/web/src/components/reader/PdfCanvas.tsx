import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const documents = new Map<string, Promise<PDFDocumentProxy>>();

export function loadPdf(url: string): Promise<PDFDocumentProxy> {
  let document = documents.get(url);
  if (!document) {
    document = pdfjs.getDocument({
      url,
      wasmUrl: "/pdfjs/wasm/",
      iccUrl: "/pdfjs/iccs/",
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
    }).promise;
    documents.set(url, document);
  }
  return document;
}

// Renders one page at the width it is laid out at, and only once it is near the viewport —
// a chapter can cover a hundred pages and rendering them all would stall the tab.
export function PdfCanvas({
  url,
  pageNumber,
  aspectRatio,
  children,
  onPointer,
}: {
  url: string;
  pageNumber: number;
  aspectRatio: number;
  children?: React.ReactNode;
  onPointer?: (x: number, y: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && setVisible(true)),
      { rootMargin: "1200px 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      const document = await loadPdf(url);
      const page = await document.getPage(pageNumber);
      const canvas = canvasRef.current;
      const host = hostRef.current;
      if (cancelled || !canvas || !host) return;

      const base = page.getViewport({ scale: 1 });
      const scale = (host.clientWidth / base.width) * Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      if (!cancelled) setRendered(true);
    })().catch(() => {});

    return () => { cancelled = true; };
  }, [url, pageNumber, visible]);

  return (
    <div
      ref={hostRef}
      className="relative w-full bg-white shadow-sm"
      style={{ aspectRatio: String(aspectRatio) }}
      data-testid="reader-page"
      data-page={pageNumber}
      onClick={(event) => {
        if (!onPointer) return;
        const box = event.currentTarget.getBoundingClientRect();
        onPointer(
          ((event.clientX - box.left) / box.width) * 10_000,
          ((event.clientY - box.top) / box.height) * 10_000,
        );
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {rendered ? children : null}
    </div>
  );
}
