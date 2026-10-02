export interface Env {
  MY_BUCKET: R2Bucket;
  DB: D1Database;
  POLICY_AUD?: string;
}

interface JWTPayload {
  sub?: string;
  aud?: string | string[];
  exp?: number;
  [key: string]: unknown;
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(";")) {
    const [key, ...valueParts] = pair.trim().split("=");
    if (key) {
      cookies[key] = valueParts.join("=");
    }
  }
  return cookies;
}

function decodeJwtBase64Url(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return atob(base64);
}

export function verifyUserToken(request: Request, env: Env): { valid: boolean; userId?: string } {
  const cookieHeader = request.headers.get("Cookie");
  const cookies = parseCookies(cookieHeader);
  const token = cookies["CF_Authorization"];

  if (!token) {
    return { valid: false };
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { valid: false };
    }

    const payloadJson = decodeJwtBase64Url(parts[1]);
    const payload = JSON.parse(payloadJson) as JWTPayload;

    // Check expiration
    if (typeof payload.exp === "number") {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp < nowSeconds) {
        return { valid: false };
      }
    }

    // Check audience if POLICY_AUD is configured
    if (env.POLICY_AUD) {
      if (!payload.aud) {
        return { valid: false };
      }
      if (Array.isArray(payload.aud)) {
        if (!payload.aud.includes(env.POLICY_AUD)) {
          return { valid: false };
        }
      } else if (payload.aud !== env.POLICY_AUD) {
        return { valid: false };
      }
    }

    if (!payload.sub) {
      return { valid: false };
    }

    return { valid: true, userId: payload.sub };
  } catch (err) {
    return { valid: false };
  }
}

function escapeHtml(value: string): string {
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

    // Handle reaction submission POST /api/react
    if (url.pathname === "/api/react" && request.method === "POST") {
      const authResult = verifyUserToken(request, env);
      if (!authResult.valid || !authResult.userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const body = (await request.json()) as { cat_pic_id?: number; emoji?: string };
        const { cat_pic_id, emoji } = body;

        if (!cat_pic_id || typeof cat_pic_id !== "number" || !emoji || typeof emoji !== "string") {
          return new Response(JSON.stringify({ error: "Invalid request body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        await env.DB.prepare(
          "INSERT INTO reactions (cat_pic_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT(cat_pic_id, user_id, emoji) DO NOTHING"
        )
          .bind(cat_pic_id, authResult.userId, emoji)
          .run();

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("Failed to insert reaction", err);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

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

    // Check user auth state for GET /
    const userAuth = verifyUserToken(request, env);

    // Otherwise, list all images and reactions from the database and render the visual grid
    let rows: Array<{ id: number; r2_key: string }> = [];
    const reactionsByCatPic = new Map<number, Array<{ emoji: string; count: number }>>();

    try {
      const [catPicsResult, reactionsResult] = await Promise.all([
        env.DB.prepare(
          "SELECT id, r2_key FROM cat_pics WHERE hidden = FALSE ORDER BY created_at DESC, id DESC"
        ).all<{ id: number; r2_key: string }>(),
        env.DB.prepare(
          "SELECT cat_pic_id, emoji, COUNT(*) as count FROM reactions GROUP BY cat_pic_id, emoji"
        ).all<{ cat_pic_id: number; emoji: string; count: number }>()
      ]);

      rows = catPicsResult.results;

      for (const reaction of reactionsResult.results) {
        const list = reactionsByCatPic.get(reaction.cat_pic_id) || [];
        list.push({ emoji: reaction.emoji, count: reaction.count });
        reactionsByCatPic.set(reaction.cat_pic_id, list);
      }
    } catch (error) {
      console.error("Failed to query cat_pics or reactions", error);
      return new Response("Unable to load images right now.", { status: 500 });
    }

    const imageCards = rows
      .map((row) => {
        const imagePath = escapeHtml(toObjectPath(row.r2_key));
        const reactions = reactionsByCatPic.get(row.id) || [];
        const reactionsHtml = reactions.length > 0
          ? `<div class="reactions-container" data-cat-pic-id="${row.id}">${reactions
              .map(
                (r) =>
                  `<span class="reaction-badge" aria-label="${r.count} ${escapeHtml(r.emoji)} reactions"><span class="emoji">
                    ${r.emoji}
                  </span><span class="count">${r.count}</span></span>`
              )
              .join("")}</div>`
          : "";

        return `<div class="gallery-card" data-cat-pic-id="${row.id}">
            <button type="button" class="thumb-button" data-cat-pic-id="${row.id}" data-image-src="${imagePath}" aria-label="Enlarge cat image">
              <img src="${imagePath}" class="thumb-image" alt="Cat picture" loading="lazy" />
            </button>
            ${reactionsHtml}
          </div>`;
      })
      .join("");

    const reactionSubmissionUiHtml = userAuth.valid
      ? `<div id="modal-reactions" class="modal-reactions">
          <span class="modal-reactions-label">React:</span>
          <div class="emoji-picker">
            <button type="button" class="emoji-btn" data-emoji="❤️" aria-label="React with ❤️">❤️</button>
            <button type="button" class="emoji-btn" data-emoji="🔥" aria-label="React with 🔥">🔥</button>
            <button type="button" class="emoji-btn" data-emoji="😻" aria-label="React with 😻">😻</button>
            <button type="button" class="emoji-btn" data-emoji="😂" aria-label="React with 😂">😂</button>
            <button type="button" class="emoji-btn" data-emoji="👍" aria-label="React with 👍">👍</button>
          </div>
        </div>`
      : "";

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Catslop</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: system-ui, sans-serif; background: #121212; color: white; padding: 20px; }
            .gallery { display: flex; flex-wrap: wrap; gap: 20px; }
            .gallery-card { display: flex; flex-direction: column; width: min(300px, calc(100vw - 60px)); }
            .thumb-button { padding: 0; border: 0; background: transparent; cursor: pointer; border-radius: 8px; width: 100%; }
            .thumb-button:focus-visible { outline: 2px solid #ffffff; outline-offset: 3px; }
            .thumb-image { width: 100%; height: min(300px, calc(100vw - 60px)); object-fit: cover; border-radius: 8px; display: block; }
            .reactions-container { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
            .reaction-badge { display: inline-flex; align-items: center; gap: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 2px 8px; font-size: 0.85rem; border: 1px solid rgba(255, 255, 255, 0.15); }
            .reaction-badge .count { font-weight: 500; color: #e0e0e0; }
            #image-modal { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.9); display: none; flex-direction: column; align-items: center; justify-content: center; padding: 24px; z-index: 1000; gap: 16px; }
            #image-modal[hidden] { display: none; }
            #image-modal[aria-hidden="false"] { display: flex; }
            #modal-image { max-width: 100%; max-height: calc(100vh - 140px); object-fit: contain; border-radius: 10px; }
            #close-modal { position: absolute; top: 12px; right: 16px; font-size: 30px; line-height: 1; color: white; background: none; border: none; cursor: pointer; }
            .modal-reactions { display: flex; align-items: center; gap: 12px; background: rgba(255, 255, 255, 0.1); padding: 8px 16px; border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.2); }
            .modal-reactions-label { font-size: 0.9rem; font-weight: 600; color: #ccc; }
            .emoji-picker { display: flex; gap: 8px; }
            .emoji-btn { background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 50%; width: 36px; height: 36px; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.1s, background 0.1s; color: white; }
            .emoji-btn:hover { transform: scale(1.15); background: rgba(255, 255, 255, 0.2); }
            .emoji-btn:disabled { opacity: 0.5; cursor: default; transform: none; }
            .visually-hidden {
              position: absolute;
              width: 1px;
              height: 1px;
              padding: 0;
              margin: -1px;
              overflow: hidden;
              clip: rect(0, 0, 0, 0);
              white-space: nowrap;
              border: 0;
            }
          </style>
        </head>
        <body>
          <h1>Catslop</h1>
          <div class="gallery">${imageCards}</div>
          <div id="image-modal" hidden aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="image-modal-title">
            <h2 id="image-modal-title" class="visually-hidden">Enlarged cat image viewer</h2>
            <button id="close-modal" type="button" aria-label="Close image viewer">&times;</button>
            <img id="modal-image" alt="Enlarged cat picture" tabindex="0" />
            ${reactionSubmissionUiHtml}
          </div>
          <script>
            const modal = document.getElementById("image-modal");
            const modalImage = document.getElementById("modal-image");
            const closeModalButton = document.getElementById("close-modal");
            const gallery = document.querySelector(".gallery");
            const modalReactions = document.getElementById("modal-reactions");

            if (modal && modalImage && closeModalButton && gallery) {
              let lastTrigger = null;
              let currentCatPicId = null;

              function openImageModal(imageSrc, catPicId, triggerElement) {
                lastTrigger = triggerElement;
                currentCatPicId = catPicId;
                modalImage.src = imageSrc;
                modal.hidden = false;
                modal.setAttribute("aria-hidden", "false");
                closeModalButton.focus();
              }

              function closeImageModal() {
                modal.setAttribute("aria-hidden", "true");
                modal.hidden = true;
                modalImage.removeAttribute("src");
                currentCatPicId = null;
                if (lastTrigger) {
                  lastTrigger.focus();
                  lastTrigger = null;
                }
              }

              gallery.addEventListener("click", (event) => {
                if (!(event.target instanceof Element)) return;
                const trigger = event.target.closest(".thumb-button");
                if (!trigger) return;
                const imageSrc = trigger.getAttribute("data-image-src");
                const catPicId = trigger.getAttribute("data-cat-pic-id");
                if (!imageSrc) return;
                openImageModal(imageSrc, catPicId, trigger);
              });

              closeModalButton.addEventListener("click", closeImageModal);
              modal.addEventListener("click", (event) => {
                if (event.target === modal) closeImageModal();
              });

              if (modalReactions) {
                modalReactions.addEventListener("click", async (event) => {
                  if (!(event.target instanceof Element)) return;
                  const btn = event.target.closest(".emoji-btn");
                  if (!btn || !currentCatPicId) return;
                  const emoji = btn.getAttribute("data-emoji");
                  if (!emoji) return;

                  try {
                    btn.disabled = true;
                    const res = await fetch("/api/react", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ cat_pic_id: Number(currentCatPicId), emoji })
                    });
                    if (res.ok) {
                      window.location.reload();
                    } else {
                      console.error("Failed to submit reaction", await res.text());
                    }
                  } catch (err) {
                    console.error("Error submitting reaction", err);
                  } finally {
                    btn.disabled = false;
                  }
                });
              }

              document.addEventListener("keydown", (event) => {
                if (modal.getAttribute("aria-hidden") !== "false") return;
                if (event.key === "Tab") {
                  const focusableElements = modal.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                  );
                  if (!focusableElements.length) return;
                  const firstElement = focusableElements[0];
                  const lastElement = focusableElements[focusableElements.length - 1];
                  const activeElement = document.activeElement;

                  if (event.shiftKey && activeElement === firstElement) {
                    event.preventDefault();
                    lastElement.focus();
                  } else if (!event.shiftKey && activeElement === lastElement) {
                    event.preventDefault();
                    firstElement.focus();
                  }
                }
                if (event.key === "Escape") {
                  closeImageModal();
                }
              });
            }
          </script>
        </body>
      </html>
    `;

    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};