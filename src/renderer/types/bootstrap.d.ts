/** ESM entry `bootstrap/dist/js/bootstrap.js` has no bundled `.d.ts`; extend as needed. */
declare module "bootstrap" {
  export class Tooltip {
    static getOrCreateInstance(
      element: Element,
      /** Bootstrap Tooltip option bag (see upstream docs); index signature allows `placement`, `title`, etc. */
      options?: {
        container?: string | Element;
        [option: string]: string | Element | undefined;
      }
    ): Tooltip;
  }
}
