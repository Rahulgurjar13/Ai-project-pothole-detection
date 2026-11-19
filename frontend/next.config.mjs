// Next.js settings.
// output: "export" = "npm run build" makes plain HTML/CSS/JS files in the "out" folder.
// The Python server (backend/server.py) shows those files, so no Node.js server is needed.
// (.mjs = a JavaScript file that uses the modern "import/export" style.)
const nextConfig = { output: "export" };   // an object holding our one setting: build a static (plain files) website
export default nextConfig;                 // hand this setting object to Next.js when it reads this file
