import { onRequest as __api_player___id___js_onRequest } from "E:\\00 projek rumah\\antigravity\\missav2\\functions\\api\\player\\[[id]].js"
import { onRequest as __api_posts___id___js_onRequest } from "E:\\00 projek rumah\\antigravity\\missav2\\functions\\api\\posts\\[[id]].js"
import { onRequest as __api_image_js_onRequest } from "E:\\00 projek rumah\\antigravity\\missav2\\functions\\api\\image.js"
import { onRequest as __api_sitemap_js_onRequest } from "E:\\00 projek rumah\\antigravity\\missav2\\functions\\api\\sitemap.js"
import { onRequest as ____catchall___js_onRequest } from "E:\\00 projek rumah\\antigravity\\missav2\\functions\\[[catchall]].js"

export const routes = [
    {
      routePath: "/api/player/:id*",
      mountPath: "/api/player",
      method: "",
      middlewares: [],
      modules: [__api_player___id___js_onRequest],
    },
  {
      routePath: "/api/posts/:id*",
      mountPath: "/api/posts",
      method: "",
      middlewares: [],
      modules: [__api_posts___id___js_onRequest],
    },
  {
      routePath: "/api/image",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_image_js_onRequest],
    },
  {
      routePath: "/api/sitemap",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_sitemap_js_onRequest],
    },
  {
      routePath: "/:catchall*",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [____catchall___js_onRequest],
    },
  ]