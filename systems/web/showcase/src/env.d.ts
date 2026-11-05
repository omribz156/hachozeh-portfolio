/// <reference types="astro/client" />
interface Window {
  HzMarketDetailChart: {
    mount(host: Element, options: Record<string, unknown>): { destroy(): void };
  };
}
