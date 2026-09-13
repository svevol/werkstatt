// Shared app registry. Modules publish their public services here so
// late-bound cross-module callbacks (canvas <-> panel <-> tree) stay
// decoupled from import order. Pure data dependencies use real imports.
// Node-safe so pure modules can be imported from unit tests.

export const HE = typeof window !== 'undefined' ? (window.HE = window.HE || {}) : {};
