import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The original README demo document is no longer in the database.
      // Keep its published link useful without depending on another document ID.
      { source: "/documents/90al206vf", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
