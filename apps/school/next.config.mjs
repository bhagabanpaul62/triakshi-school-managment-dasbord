import { withSmw } from "@smw/config/next";

export default withSmw({
  images: { unoptimized: true },
  // PDF fonts are read from disk at run time, so the standalone build must carry them.
  outputFileTracingIncludes: { "/*": ["../../node_modules/.pnpm/@fontsource+noto-sans*/node_modules/@fontsource/*/files/*-{400,700}-normal.woff"] },
});
