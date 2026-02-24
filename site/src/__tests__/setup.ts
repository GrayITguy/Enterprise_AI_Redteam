import "@testing-library/jest-dom";

// Recharts (and similar charting libs) use ResizeObserver which jsdom doesn't provide.
// Stub it so chart-containing components don't throw on mount.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
