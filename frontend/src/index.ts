export interface Env {
  MY_BUCKET: R2Bucket;
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

    // Otherwise, list all objects in the bucket and render the visual grid
    const objects = await env.MY_BUCKET.list();
    const imageTags = objects.objects
      .map(
        (obj) =>
          `<img src="/${obj.key}" style="width: 300px; height: 300px; object-fit: cover; margin: 10px; border-radius: 8px;" />`
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