function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type",
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);

    try {
      // APIトップ
      if (url.pathname === "/") {
        return json({
          ok: true,
          name: "keiba-lab-api",
          message: "Keiba Lab API is running",
        });
      }

      // D1接続確認
      if (url.pathname === "/api/health") {
        const result = await env.DB
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
          )
          .all();

        return json({
          ok: true,
          database: "connected",
          tables: result.results,
        });
      }

      // レースデータ
      if (url.pathname === "/api/races") {
       
