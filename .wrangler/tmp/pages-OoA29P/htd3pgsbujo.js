// <define:__ROUTES__>
var define_ROUTES_default = {
  version: 1,
  description: "Cloudflare Pages route exclusion \u2014 file statis tidak melewati Worker",
  include: [
    "/*"
  ],
  exclude: [
    "/assets/*",
    "/sitemaps/*",
    "/robots.txt",
    "/favicon.ico",
    "/_headers",
    "/b773d20d41194391a49701f57581638e.txt"
  ]
};

// C:/Users/Roxy Emanuel/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-dev-pipeline.ts
import worker from "E:\\00 projek rumah\\antigravity\\missav2\\.wrangler\\tmp\\pages-OoA29P\\functionsWorker-0.6139057298462968.mjs";
import { isRoutingRuleMatch } from "C:\\Users\\Roxy Emanuel\\AppData\\Local\\npm-cache\\_npx\\32026684e21afda6\\node_modules\\wrangler\\templates\\pages-dev-util.ts";
export * from "E:\\00 projek rumah\\antigravity\\missav2\\.wrangler\\tmp\\pages-OoA29P\\functionsWorker-0.6139057298462968.mjs";
var routes = define_ROUTES_default;
var pages_dev_pipeline_default = {
  fetch(request, env, context) {
    const { pathname } = new URL(request.url);
    for (const exclude of routes.exclude) {
      if (isRoutingRuleMatch(pathname, exclude)) {
        return env.ASSETS.fetch(request);
      }
    }
    for (const include of routes.include) {
      if (isRoutingRuleMatch(pathname, include)) {
        const workerAsHandler = worker;
        if (workerAsHandler.fetch === void 0) {
          throw new TypeError("Entry point missing `fetch` handler");
        }
        return workerAsHandler.fetch(request, env, context);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  pages_dev_pipeline_default as default
};
//# sourceMappingURL=htd3pgsbujo.js.map
