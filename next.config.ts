import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not add KINGSHOT_API_KEY to `env` here. That would bake the build-time
  // value (often empty on Vercel) into the server bundle. Server code reads it
  // at request time via lib/env.ts.
  serverExternalPackages: ["@supabase/supabase-js"],
};

export default nextConfig;
