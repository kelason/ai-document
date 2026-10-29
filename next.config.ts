import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["mammoth", "yauzl", "fast-xml-parser"],
  // Compile the CommonJS sanitizer and its ESM parser together. Serverless
  // runtimes may disable require(ESM), even on Node 24.
  transpilePackages: ["sanitize-html", "htmlparser2"],
  outputFileTracingIncludes: {
    "/api/documents/*/upload": [
      "./node_modules/mammoth/**/*",
      "./node_modules/yauzl/**/*",
      "./node_modules/fast-xml-parser/**/*",
      // The import worker loads the sanitizer outside the bundled route.
      "./node_modules/{sanitize-html,escape-string-regexp,htmlparser2,domelementtype,domhandler,domutils,dom-serializer,entities,is-plain-object,launder,dayjs,parse-srcset,postcss,nanoid,picocolors,source-map-js}/**/*",
    ],
  },
  async redirects() {
    return [
      // The original README demo document is no longer in the database.
      // Keep its published link useful without depending on another document ID.
      { source: "/documents/90al206vf", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
