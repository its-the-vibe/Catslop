export interface Env {
  AI: Ai;
  MY_BUCKET: R2Bucket;
  DB: D1Database;
}

export default {
  // Triggered automatically by the Cron schedule
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`Cron job started at ${controller.scheduledTime}`);

    // Core execution kept within ctx.waitUntil so the process stays alive
    ctx.waitUntil(generateAndStoreImage(env));
  },

  // Optional: Also allow manual HTTP triggers for testing
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    ctx.waitUntil(generateAndStoreImage(env));
    return new Response("Daily image generation triggered manually!", { status: 200 });
  }
};

async function generateAndStoreImage(env: Env): Promise<void> {
  const model = "@cf/black-forest-labs/flux-1-schnell";
  const prompts = [
    "An elegant cat composed of swirling golden vines, stained glass patterns, and floral Alphonse Mucha motifs, soft jewel tones, intricate linework.",
    "A cozy cat sitting by a sunlit window, impasto oil painting with visible brushstrokes, vibrant sunlight filters, Monet style.",
    "A majestic cat resting under a blooming cherry blossom tree, traditional Japanese woodblock print, wave textures, muted ink tones.",
    "A playful cat leaping through a field of colorful flowers, digital illustration with a whimsical style, bright and cheerful colors.",
    "A mysterious cat with glowing eyes sitting on a moonlit rooftop, gothic fantasy style, dark and moody atmosphere.",
    "A regal cat adorned with a crown of flowers, sitting on a velvet throne, baroque painting style, rich and opulent colors.",
    "A whimsical cat leaping through the air, loose splashy watercolor painting, soft pastel color bleeds, delicate ink outlines.",
    "A bold graphic portrait of a cat wearing retro sunglasses, Andy Warhol screenprint style, bright neon cyan and hot pink halftone dots.",
    "A serene cat meditating on a mountaintop at sunrise, traditional Chinese ink painting style, soft gradients and flowing brushwork.",
    "A mischievous cat peeking out from a pile of autumn leaves, whimsical illustration style, warm earthy tones and playful composition."
  ];
  
  // Pick a random prompt or pull from a database/API
  const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];

  console.log(`Generating image for prompt: "${randomPrompt}"`);

  // 1. Generate the image using Workers AI GPU cluster
  const imageResponse = await env.AI.run(model, {
    prompt: randomPrompt,
    steps: 4,
  }) as { image: string };

  // 2. Decode the base64 string into a Uint8Array
  const base64Data = imageResponse.image;
  const binaryString = atob(base64Data);
  const imageBuffer = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));

  // 3. Generate a timestamped key for the object
  const isoTimestamp = new Date().toISOString();

  const safeTimestamp = isoTimestamp.replace(/[:.]/g, "-");

  const filename = `daily/${safeTimestamp}_cat.png`;
  
  // 4. Save to R2, then persist metadata in D1
  await env.MY_BUCKET.put(filename, imageBuffer, {
    httpMetadata: {
      contentType: "image/png",
    },
    customMetadata: {
      prompt: randomPrompt,
      generatedAt: isoTimestamp
    }
  });

  try {
    await env.DB.prepare(
      "INSERT INTO cat_pics (r2_key, model, prompt, hidden) VALUES (?, ?, ?, ?)"
    )
      .bind(filename, model, randomPrompt, false)
      .run();
  } catch (error) {
    console.error("Failed to write cat_pics record", error);
    try {
      await env.MY_BUCKET.delete(filename);
    } catch (deleteError) {
      console.error("Failed to clean up orphaned R2 object", deleteError);
    }
    throw error;
  }

  console.log(`Successfully stored image as ${filename} in R2!`);
}