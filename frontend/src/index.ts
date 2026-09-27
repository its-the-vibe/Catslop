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

function toObjectPath(r2Key: string): string {
  return `/${r2Key.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
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
          const imagePath = escapeHtmlAttribute(toObjectPath(row.r2_key));
          return `<button type="button" class="thumb-button" data-image-src="${imagePath}" aria-label="Enlarge cat image"><img src="${imagePath}" class="thumb-image" alt="Cat picture" loading="lazy" /></button>`;
        }
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Catslop</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: system-ui, sans-serif; background: #121212; color: white; padding: 20px; }
            .gallery { display: flex; flex-wrap: wrap; gap: 20px; }
            .thumb-button { padding: 0; border: 0; background: transparent; cursor: pointer; border-radius: 8px; }
            .thumb-image { width: min(300px, calc(100vw - 60px)); height: min(300px, calc(100vw - 60px)); object-fit: cover; border-radius: 8px; display: block; }
            #image-modal { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.9); display: none; align-items: center; justify-content: center; padding: 24px; z-index: 1000; }
            #image-modal[aria-hidden="false"] { display: flex; }
            #modal-image { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 10px; }
            #close-modal { position: absolute; top: 12px; right: 16px; font-size: 30px; line-height: 1; color: white; background: none; border: none; cursor: pointer; }
          </style>
        </head>
        <body>
          <h1>Catslop</h1>
          <div class="gallery">${imageTags}</div>
          <div id="image-modal" aria-hidden="true">
            <button id="close-modal" type="button" aria-label="Close image viewer">&times;</button>
            <img id="modal-image" alt="Enlarged cat picture" />
          </div>
          <script>
            const modal = document.getElementById("image-modal");
            const modalImage = document.getElementById("modal-image");
            const closeModalButton = document.getElementById("close-modal");
            const gallery = document.querySelector(".gallery");

            function openImageModal(imageSrc) {
              modalImage.src = imageSrc;
              modal.setAttribute("aria-hidden", "false");
            }

            function closeImageModal() {
              modal.setAttribute("aria-hidden", "true");
              modalImage.removeAttribute("src");
            }

            if (modal && modalImage && closeModalButton && gallery) {
              gallery.addEventListener("click", (event) => {
                if (!(event.target instanceof Element)) return;
                const trigger = event.target.closest(".thumb-button");
                if (!trigger) return;
                const imageSrc = trigger.getAttribute("data-image-src");
                if (!imageSrc) return;
                openImageModal(imageSrc);
              });

              closeModalButton.addEventListener("click", closeImageModal);
              modal.addEventListener("click", (event) => {
                if (event.target === modal) closeImageModal();
              });

              document.addEventListener("keydown", (event) => {
                if (event.key === "Escape" && modal.getAttribute("aria-hidden") === "false") {
                  closeImageModal();
                }
              });
            }
          </script>
        </body>
      </html>
    `;

    return new Response(html, { headers: { "content-type": "text/html" } });
  },
};