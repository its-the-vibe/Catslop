export interface Env {
  MY_BUCKET: R2Bucket;
  DB: D1Database;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve a single image when requested (e.g., /vacation.jpg)
    if (url.pathname !== "/") {
      const objectKey = url.pathname.slice(1);
      const object = await env.MY_BUCKET.get(objectKey);

      if (!object) return new Response("Image Not Found", { status: 404 });

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);

      return new Response(object.body, { headers });
    }

    // Otherwise, list all images from the database and render the visual grid
    let rows: Array<{ r2_key: string }> = [];
    try {
      const result = await env.DB.prepare(
        "SELECT r2_key FROM cat_pics WHERE hidden = FALSE ORDER BY created_at DESC, id DESC"
      ).all<{ r2_key: string }>();
      rows = result.results;
    } catch (error) {
      console.error("Failed to query cat_pics", error);
      return new Response("Unable to load images right now.", { status: 500 });
    }

    const imageTags = rows
      .map(
        (row) => {
          const imagePath = escapeHtmlAttribute(`/${encodeURI(row.r2_key)}`);
          return `<img src="${imagePath}" style="width: 300px; height: 300px; object-fit: cover; margin: 10px; border-radius: 8px;" />`;
        }
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Catslop</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: system-ui, sans-serif; background: #121212; color: white; padding: 20px;">
          <h1>Catslop</h1>
          <div style="display: flex; flex-wrap: wrap;">${imageTags}</div>
        </body>
      </html>
    `;

    return new Response(html, { headers: { "content-type": "text/html" } });
  },
};