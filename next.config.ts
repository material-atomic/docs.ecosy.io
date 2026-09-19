import type { NextConfig } from "next";

/* "export" is what makes vinext write dist/client/*.html instead of running
   a Worker — measured (task 0063 mục 2.4, ca D): with this plus the six
   force-static pages, `vinext build` writes 38 rendered routes as files. */
const nextConfig: NextConfig = { output: "export" };

export default nextConfig;
