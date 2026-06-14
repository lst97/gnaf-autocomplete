import { Elysia } from "elysia";

async function serveStatic(path: string, contentType: string, notFoundBody?: string) {
  const file = Bun.file(path);
  if (await file.exists()) {
    return new Response(file, { headers: { "Content-Type": contentType } });
  }
  return new Response(notFoundBody ?? "", { status: 404 });
}

const securityTxtFallback =
  "Contact: mailto:laisiotou1997@gmail.com\n" +
  "Expires: 2027-06-15T00:00:00.000Z\n" +
  "Preferred-Languages: en\n";

export const staticRoute = new Elysia()
  .get("/favicon.ico", async () => {
    const file = Bun.file("pages/assets/favicon.svg");
    if (await file.exists()) {
      return new Response(file, {
        headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
      });
    }
    return new Response("", { status: 404 });
  })
  .get("/robots.txt", async () =>
    serveStatic("pages/robots.txt", "text/plain; charset=utf-8", "User-agent: *\nDisallow: /\n"),
  )
  .get("/.well-known/security.txt", async () =>
    serveStatic("pages/.well-known/security.txt", "text/plain; charset=utf-8", securityTxtFallback),
  )
  .get("/analytics", async () =>
    serveStatic("pages/analytics.html", "text/html; charset=utf-8", "Analytics page not found."),
  )
  .get("/style.css", async () =>
    serveStatic("pages/style.css", "text/css; charset=utf-8", "/* not found */"),
  )
  // Tab fragments (lazy-loaded by main.html)
  .get("/suggest-tab.html", async () =>
    serveStatic("pages/suggest-tab.html", "text/html; charset=utf-8"),
  )
  .get("/detail-tab.html", async () =>
    serveStatic("pages/detail-tab.html", "text/html; charset=utf-8"),
  )
  .get("/keys-tab.html", async () => serveStatic("pages/keys-tab.html", "text/html; charset=utf-8"))
  .get("/guide-tab.html", async () =>
    serveStatic("pages/guide-tab.html", "text/html; charset=utf-8"),
  )
  .get("/loader-tab.html", async () =>
    serveStatic("pages/loader-tab.html", "text/html; charset=utf-8"),
  )
  .get("/system-tab.html", async () =>
    serveStatic("pages/system-tab.html", "text/html; charset=utf-8"),
  )
  // JS modules
  .get("/assets/common.js", async () =>
    serveStatic("pages/assets/common.js", "application/javascript; charset=utf-8", "// not found"),
  )
  .get("/assets/suggest.js", async () =>
    serveStatic("pages/assets/suggest.js", "application/javascript; charset=utf-8", "// not found"),
  )
  .get("/assets/detail.js", async () =>
    serveStatic("pages/assets/detail.js", "application/javascript; charset=utf-8", "// not found"),
  )
  .get("/assets/system.js", async () =>
    serveStatic("pages/assets/system.js", "application/javascript; charset=utf-8", "// not found"),
  )
  .get("/assets/keys.js", async () =>
    serveStatic("pages/assets/keys.js", "application/javascript; charset=utf-8", "// not found"),
  )
  .get("/", async () => {
    const file = Bun.file("pages/main.html");
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
    return new Response(
      '<html><body style="background:#111;color:#e6e;font-family:sans-serif;padding:40px">' +
        "<h1>pages/main.html not found</h1><p>Run from the project root directory or check the file exists.</p>" +
        "</body></html>",
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  })
  // Redirects
  .get("/docs", () => Response.redirect("/openapi", 302))
  .get("/openapi.json", () => Response.redirect("/openapi/json", 302));
