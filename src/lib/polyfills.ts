// ===== Polyfills para Macs con Safari antiguo =====
// En macOS la app usa el motor de Safari instalado en el sistema (WKWebView).
// Safari anterior a 17.4 (macOS 14.4) no tiene Promise.withResolvers, que pdf.js necesita.
// Este archivo debe importarse ANTES que pdf.js.

const P = Promise as any;
if (typeof P.withResolvers !== 'function') {
  P.withResolvers = function <T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (r?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

// Array.prototype.at (Safari < 15.4)
if (!(Array.prototype as any).at) {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true, writable: true,
    value: function (this: any[], n: number) {
      n = Math.trunc(n) || 0;
      if (n < 0) n += this.length;
      return n < 0 || n >= this.length ? undefined : this[n];
    }
  });
}

export {};
