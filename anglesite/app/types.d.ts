/**
 * Global type declarations for modules without types
 */

declare module '@11ty/eleventy' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Eleventy: any;
  export = Eleventy;
}

declare module '@11ty/eleventy-dev-server' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const EleventyDevServer: any;
  export = EleventyDevServer;
}

declare module '@11ty/eleventy-plugin-webc' {
  interface WebCOptions {
    components?: string[];
    layouts?: string | string[];
    bundlerMode?: boolean;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webCPlugin: (eleventyConfig: any, options?: WebCOptions) => void;
  export = webCPlugin;
}

declare module '@dwk/anglesite-11ty' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anglesitePlugin: (eleventyConfig: any) => { name: string };
  export = anglesitePlugin;
}
