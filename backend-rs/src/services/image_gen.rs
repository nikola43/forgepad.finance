//! Fusion image generation for token creation.
//!
//! Fyuz's core mechanic is "two icons enter, one market leaves": the creator
//! names two characters and the platform generates a single fused character
//! image (see brand guidelines §11). This module turns two character
//! names/descriptions into PNG bytes; the caller uploads them to S3.
//!
//! Provider is chosen by IMAGE_GEN_PROVIDER:
//!   - "openai" (default): OpenAI Images API (gpt-image-1). Requires OPENAI_API_KEY.
//!   - "mock": a deterministic placeholder (no external key). For localnet, so the
//!             whole create -> generate -> S3 -> launch flow is testable offline.
//! Production is never silently downgraded: the openai provider errors loudly if
//! its key is missing rather than falling back to a placeholder.

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use serde_json::json;

/// A generated image ready to store: raw bytes plus their format.
pub struct GeneratedImage {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
    pub content_type: &'static str,
}

/// Curated universes/art styles for fusions: (label shown to users, base prompt
/// injected into the image prompt). When the creator leaves the style field
/// blank, one is picked at random so fusions stay visually varied.
///
/// Each base prompt owns the FULL art direction — medium, technique, wardrobe,
/// palette, lighting, and background — so every style is internally coherent
/// instead of fighting one fixed photographic look. The brand fingerprint
/// (near-black backdrop, citron-left/magenta-right rim light — brand §11) is
/// reinterpreted in each style's own visual language.
pub const STYLES: &[(&str, &str)] = &[
    ("Dragon Ball Z / anime action", "Rendered as high-energy Dragon Ball Z style anime action art: bold cel shading with hard two-tone shadows, thick confident linework, a crackling golden ki aura with electric arcs, fierce determined expression — while keeping each subject's own recognizable hairstyle and facial features rather than a generic anime face. Deep near-black tournament-night background; a citron-green rim light from the left and a magenta rim light from the right."),
    ("Cyberpunk neon", "Rendered in cyberpunk neon style: rain-flecked skin lit by holographic advertisements, subtle chrome implants and glowing circuit tattoos, a high techwear collar, teal-and-magenta neon reflections, cinematic haze. Near-black megacity night background; citron-green neon rim light from the left and hot magenta neon from the right."),
    ("Medieval fantasy", "Rendered as painterly medieval fantasy art: ornate engraved armor or embroidered robes with fur and leather trim, a weathered heroic face, epic oil-illustration brushwork like a fantasy book cover. Dark castle-hall gloom behind; green torch-fire rim light from the left and rose-magenta arcane glow from the right."),
    ("Studio Ghibli-style", "Rendered as a gentle hand-drawn Ghibli-style animation still: soft rounded features, warm expressive eyes, clean thin outlines, painterly gouache shading, wind-touched hair, quiet wonder in the expression. Deep dusk-dark background with soft painterly texture; a gentle green lantern glow from the left and a pink twilight glow from the right."),
    ("Pixel art / 8-bit", "Rendered as retro pixel art: a chunky 16-bit character portrait with crisp pixel clusters, a limited 16-color palette, dithered shading, sharp jagged silhouette, arcade fighting-game select-screen framing. Near-black pixel background; lime-green pixel rim light on the left edge and magenta pixel rim light on the right."),
    ("Film noir comic", "Rendered as film noir comic art: stark high-contrast black-and-white inks, chiaroscuro slabs of shadow, venetian-blind light slats across the face, a trench-coat collar in cigarette-smoke atmosphere, rough brush and halftone texture. Pitch-black background; one hard pale-green key light from the left and a faint magenta gleam from the right."),
    ("Classic superhero comic", "Rendered as classic Silver-Age superhero comic art: bold black ink outlines, Ben-Day halftone dots, dynamic heroic chest-up pose, saturated primary-color costume, vintage newsprint texture. Dark inked background with a burst of speedlines; green rim light from the left and magenta rim light from the right."),
    ("Renaissance oil painting", "Rendered as a Renaissance oil painting: sfumato blending and warm chiaroscuro, glazed earth tones with deep umber shadows, period drapery, dignified three-quarter lighting, fine craquelure varnish texture, old-master museum quality. Near-black gallery background; a subtle green-gold rim from the left and a faint rose glow from the right."),
    ("Claymation / stop-motion", "Rendered as a claymation stop-motion puppet: visible thumbprints in soft plasticine, slightly lumpy handcrafted features, glossy bead eyes, felt and wire costume details, miniature-set shallow depth of field. Dark miniature-stage background; a green stage-gel light from the left and a pink gel from the right."),
    ("Retro 80s synthwave", "Rendered in retro 80s synthwave style: airbrushed chrome-and-sunset gradients, mirrored aviators or glowing eyes, popped jacket collar, scanline shimmer and VHS chroma bleed. Deep purple-black horizon with a faint neon grid; electric lime rim light from the left and hot pink rim light from the right."),
    ("Steampunk", "Rendered in steampunk style: polished brass goggles pushed up on the brow, a Victorian waistcoat with gear-and-rivet details, coiled copper piping and wisps of steam, warm sepia-and-bronze palette with painterly grit. Dark boiler-room background; green gaslight rim from the left and rose furnace-glow from the right."),
    ("Wild West", "Rendered as cinematic Wild West art: a weathered wide-brim hat, sun-cracked squinting features, a dusty duster coat and bandana, warm ochre grit in the air, painted like a spaghetti-western poster. Near-black saloon dark behind; green oil-lamp rim light from the left and dusty rose sunset light from the right."),
    ("Ancient mythology (Greek/Norse)", "Rendered as ancient mythology art: a godlike figure with marble-smooth skin or braided battle-worn hair, bronze and gold ornamentation, laurels or carved runes, storm clouds and epic grandeur painted like a temple mural. Near-black temple darkness; green Aegean rim light from the left and wine-rose glow from the right."),
    ("Space opera / sci-fi epic", "Rendered as space opera concept art: a sleek high-collared command uniform or segmented exosuit, starlight catching brushed metal, a nebula's glow on the face, cinematic sci-fi matte-painting finish. Deep-space black background with faint stars; citron-green console light from the left and magenta nebula light from the right."),
    ("Watercolor illustration", "Rendered as a fine watercolor illustration: translucent layered washes, soft wet-in-wet blooms along the edges, controlled dry-brush detail in the face, pigment granulation and visible cold-press paper texture. Dark ink-wash background; a green wash glowing from the left and a rose wash from the right."),
    ("Graffiti / street art", "Rendered as graffiti street art on a dark wall: confident spray-paint strokes with soft overspray, crisp stencil edges, wildstyle energy, paint drips running from the jawline, sticker-and-tag texture at the margins. Near-black concrete background; acid-green spray glow from the left and magenta spray glow from the right."),
    ("Samurai / feudal Japan", "Rendered as ukiyo-e influenced samurai art: flat elegant woodblock linework, lacquered armor plates or an indigo-dyed kimono, a topknot or kabuto helmet, drifting cherry-blossom petals, washi paper grain and ink-wash clouds. Near-black indigo night; green paper-lantern glow from the left and plum-blossom pink glow from the right."),
    ("Post-apocalyptic wasteland", "Rendered as post-apocalyptic wasteland art: cracked goggles and a patched respirator hanging at the neck, scavenged plate armor over sun-bleached rags, dust-scoured skin, rust and ash palette, gritty cinematic concept-art finish. Near-black storm-dark background; toxic green rim light from the left and ember-rose glow from the right."),
    ("Pop art (Warhol-style)", "Rendered as Warhol-style pop art: flat silkscreened color blocks with deliberately offset registration, high-contrast posterized features, bold unnatural color choices, visible screenprint grain. Near-black backdrop panel; a lime-green color-field edge on the left and a magenta field on the right."),
    ("Gothic horror", "Rendered as gothic horror art: porcelain-pale skin, sunken candlelit eyes, a high lace or leather collar, Victorian dark-romance styling, engraved silver details, oil-dark painterly dread. Pitch-black crypt background with faint fog; sickly green candle rim light from the left and blood-rose glow from the right."),
    ("Egyptian mythology", "Rendered as ancient Egyptian mythology art: a gold-and-lapis pharaonic headdress, kohl-lined eyes, a broad jeweled collar, hieroglyph-carved details, burnished gold-leaf highlights against basalt. Near-black tomb darkness; green scarab-glow rim light from the left and rose desert-dusk light from the right."),
    ("Cartoon Network style", "Rendered as a modern Cartoon Network style character: thick clean vector outlines, flat saturated color fills, exaggerated playful proportions with a big expressive head, snappy 2D TV-animation finish. Near-black flat background; lime-green rim glow from the left and magenta rim glow from the right."),
    ("Vaporwave", "Rendered in vaporwave style: dreamy pastel pink-and-teal gradients washing over marble-white skin like a classical bust, glitch slices and RGB channel splits, faint retro-computer artifacts, nostalgic digital haze. Deep violet-black backdrop; seafoam-green glow from the left and bubblegum-pink glow from the right."),
    ("Baroque royal portrait", "Rendered as a Baroque royal portrait: dramatic tenebrism with a single shaft of light, opulent velvet and gold-braided regalia, a lace ruff or jeweled chain, rich impasto highlights over deep glazes, grand old-master gravitas. Near-black palace shadow; a green-gold gleam from the left and a crimson-rose gleam from the right."),
    ("Manga black-and-white", "Rendered as black-and-white manga art: precise G-pen ink linework, layered screentone shading, dramatic cross-hatching, expressive glossy eyes with sharp highlights, speed-lines radiating tension, crisp tankobon print quality. Solid black background; a pale green-tinted rim from the left and a soft grey-pink rim from the right."),
];

/// Default style when the creator leaves the style field blank: a clean,
/// semi-realistic portrait that keeps BOTH source faces recognizable instead of
/// repainting them into a costume universe. Blank used to pick a random curated
/// STYLES entry, which is how e.g. a Dragon Ball Z pick turned any two people
/// into a generic Goku. Curated styles are now only applied when explicitly
/// chosen.
const NEUTRAL_STYLE: (&str, &str) = (
    "Signature portrait",
    "Rendered as a photorealistic studio portrait: true-to-life facial structure \
     and realistic skin detail, natural proportions, soft even cinematic \
     studio-key light on the face, crisp and modern. Deep near-black studio \
     background with subtle citron-green and magenta rim-light accents glancing \
     off the hair and shoulders (keep the face evenly lit, no hard split).",
);

/// The style actually used for a generation: the canonical label (persisted on
/// the token, shown in the UI) and the prompt clause fed to the image model.
pub struct ResolvedStyle {
    pub label: String,
    pub clause: String,
}

/// Resolve the creator's style input: blank → the neutral face-preserving
/// default; a curated label (case-insensitive) → its tuned prompt clause;
/// anything else → the free text used directly as a style directive.
pub fn resolve_style(input: Option<&str>) -> ResolvedStyle {
    let input = input.map(str::trim).unwrap_or("");
    if input.is_empty() {
        let (label, clause) = NEUTRAL_STYLE;
        return ResolvedStyle { label: label.to_string(), clause: clause.to_string() };
    }
    if let Some((label, clause)) = STYLES
        .iter()
        .find(|(label, _)| label.eq_ignore_ascii_case(input))
    {
        return ResolvedStyle { label: label.to_string(), clause: clause.to_string() };
    }
    // Free text: commit to the requested universe, then restate the brand
    // staging that curated entries carry in their own base prompts.
    ResolvedStyle {
        label: input.to_string(),
        clause: format!(
            "Rendered in the style of {input}: fully committed to that universe's \
             visual language, wardrobe, palette, and mood, while keeping each \
             source character's own recognizable face. Near-black dark \
             background in that style; a citron-green rim light from the left and \
             a magenta rim light from the right."
        ),
    }
}

/// Build the Fyuz fusion prompt from two characters (brand §11) plus a style
/// base prompt (from `resolve_style`).
///
/// The skeleton only pins what every fusion shares: one fused character,
/// chest-up and centered, and the text/watermark ban that keeps results usable
/// as a token logo. All art direction — medium, lighting, background, and the
/// brand's chamber staging reinterpreted per style — lives in the style clause.
fn fusion_prompt(
    character1: &str,
    character2: &str,
    name: Option<&str>,
    style_clause: &str,
    has_refs: bool,
) -> String {
    let named = match name {
        Some(n) if !n.trim().is_empty() => {
            format!(" The resulting character is called \"{}\".", n.trim())
        }
        _ => String::new(),
    };
    // With reference photos the model blends the actual faces, so point it at
    // them; without, it only has the names to work from and needs the harder
    // "don't collapse to one/a generic face" steering.
    let lead = if has_refs {
        format!(
            "Using the two reference photos as the two people to combine, fuse \
             \"{c1}\" and \"{c2}\" into ONE single person — an even 50/50 blend \
             giving equal weight to both, so each is clearly recognizable in the \
             single resulting face.",
            c1 = character1.trim(),
            c2 = character2.trim(),
        )
    } else {
        format!(
            "A portrait that fuses \"{c1}\" and \"{c2}\" into one single person \
             as an even 50/50 blend — give EQUAL weight to both, average their \
             age, build and skin, and combine each one's most distinctive, \
             recognizable features into the same face. Both must be clearly \
             recognizable at once; if the result looks like only one of them, it \
             is wrong.",
            c1 = character1.trim(),
            c2 = character2.trim(),
        )
    };
    format!(
        "{lead}{named} One character only, chest-up, centered, facing camera, \
         natural proportions. {style} Keep both identities equally present \
         throughout. Sharp, high detail. No text, no watermark, no logos, no \
         borders.",
        lead = lead,
        named = named,
        style = style_clause,
    )
}

/// Look up a representative portrait for a character name via Wikipedia's
/// page-image API (free, no key, covers essentially every public figure).
/// Returns the thumbnail URL, or None when there's no page/image — the caller
/// then falls back to a text-only prompt. Never errors the whole generation.
async fn fetch_reference_image(client: &reqwest::Client, name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    // generator=search finds the best-matching page even for loose input
    // ("CZ Binance"); pageimages returns that page's lead portrait.
    let api = format!(
        "https://en.wikipedia.org/w/api.php?action=query&generator=search\
         &gsrsearch={q}&gsrlimit=1&prop=pageimages&piprop=thumbnail\
         &pithumbsize=768&format=json&redirects=1",
        q = urlencoding(name),
    );
    let resp = client
        .get(&api)
        // Wikipedia requires a descriptive User-Agent or it 403s.
        .header(reqwest::header::USER_AGENT, "fyuz-fusion/1.0 (https://fyuz.fun)")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    let body: serde_json::Value = resp.json().await.ok()?;
    let pages = body.get("query")?.get("pages")?.as_object()?;
    // generator=search returns pages keyed by id; take the first with a thumb.
    pages
        .values()
        .find_map(|p| p.get("thumbnail").and_then(|t| t.get("source")).and_then(|s| s.as_str()))
        .map(str::to_string)
}

/// Generate a fusion image. Returns PNG (or SVG for the mock) bytes.
/// `style_clause` comes from `resolve_style` — always present, never blank.
pub async fn generate_fusion(
    character1: &str,
    character2: &str,
    name: Option<&str>,
    style_clause: &str,
) -> Result<GeneratedImage> {
    let provider = std::env::var("IMAGE_GEN_PROVIDER").unwrap_or_else(|_| "openai".to_string());
    match provider.as_str() {
        "mock" => generate_mock(character1, character2, style_clause).await,
        "openai" => generate_openai(character1, character2, name, style_clause).await,
        "local" => generate_local(character1, character2, name, style_clause).await,
        other => Err(anyhow!("Unknown IMAGE_GEN_PROVIDER: {other}")),
    }
}

/// Local CPU generation via stable-diffusion.cpp (the `sd` CLI baked into the
/// backend image), tuned for SD-Turbo-class models: few steps, cfg 1.0, 512px.
///
/// Serialized through a global permit: this host has 2 vCPUs and ~4 GB of
/// headroom, so a second concurrent generation would OOM-fight the model
/// (~2 GB resident) and double both jobs' latency. Queued jobs simply wait —
/// the job poller keeps reporting progress to the client meanwhile.
async fn generate_local(
    character1: &str,
    character2: &str,
    name: Option<&str>,
    style_clause: &str,
) -> Result<GeneratedImage> {
    static PERMIT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
    let _permit = PERMIT.acquire().await.expect("semaphore is never closed");

    let model = std::env::var("SD_MODEL_PATH")
        .ok()
        .filter(|p| !p.is_empty())
        .context("SD_MODEL_PATH is not set — cannot generate token image locally")?;
    let bin = std::env::var("SD_BIN").unwrap_or_else(|_| "sd".to_string());
    let steps = std::env::var("SD_STEPS").unwrap_or_else(|_| "4".to_string());
    let threads = std::env::var("SD_THREADS").unwrap_or_else(|_| "2".to_string());
    let size = std::env::var("SD_SIZE").unwrap_or_else(|_| "512".to_string());

    // CLIP reads 77 tokens per chunk and turbo models follow the leading
    // tokens best; fusion_prompt already puts the fusion sentence before the
    // paragraph-length style clause, which is the right order here too.
    let prompt = fusion_prompt(character1, character2, name, style_clause, false);

    let out = std::env::temp_dir().join(format!("sd-{}.png", uuid::Uuid::new_v4()));
    let out_path = out.to_str().context("temp path is not valid UTF-8")?.to_string();

    let run = tokio::process::Command::new(&bin)
        .args([
            "-m", &model,
            "-p", &prompt,
            "--steps", &steps,
            "--cfg-scale", "1.0",
            "-W", &size,
            "-H", &size,
            "-t", &threads,
            "--seed", "-1",
            "-o", &out_path,
        ])
        .output();
    let result = tokio::time::timeout(std::time::Duration::from_secs(900), run)
        .await
        .map_err(|_| anyhow!("local image generation timed out after 15 minutes"))?
        .context("failed to run sd (stable-diffusion.cpp)")?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let tail = stderr.lines().rev().take(5).collect::<Vec<_>>();
        let tail = tail.into_iter().rev().collect::<Vec<_>>().join(" | ");
        return Err(anyhow!("sd exited with {}: {tail}", result.status));
    }

    let bytes = tokio::fs::read(&out)
        .await
        .context("sd reported success but produced no output image")?;
    let _ = tokio::fs::remove_file(&out).await;
    Ok(GeneratedImage {
        bytes,
        ext: "png",
        content_type: "image/png",
    })
}

/// OpenAI-compatible Images API. Works against real OpenAI (gpt-image-1) and
/// against compatible serverless providers (Together AI gpt-image-2, DeepInfra,
/// …) serving models like gpt-image-2 or FLUX — select via OPENAI_API_BASE +
/// OPENAI_IMAGE_MODEL. Provider quirks handled here:
///   - real OpenAI: takes a single "size" string; always returns b64_json;
///     accepts the proprietary "moderation" param (needed — fusions name real
///     public figures).
///   - compatible providers: take "width"/"height" (not "size"); default to
///     returning a URL, so we request b64_json explicitly and still accept a
///     URL response as fallback; reject unknown params like "moderation", so
///     it's only sent to api.openai.com. An optional OPENAI_IMAGE_STEPS tunes
///     the sampler step count (e.g. 28 for gpt-image-2, ~4 for FLUX schnell).
async fn generate_openai(
    character1: &str,
    character2: &str,
    name: Option<&str>,
    style_clause: &str,
) -> Result<GeneratedImage> {
    let api_key = std::env::var("OPENAI_API_KEY")
        .ok()
        .filter(|k| !k.is_empty())
        .context("OPENAI_API_KEY is not set — cannot generate token image")?;
    let base = std::env::var("OPENAI_API_BASE")
        .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
    let is_real_openai = base.contains("api.openai.com");
    let base_model =
        std::env::var("OPENAI_IMAGE_MODEL").unwrap_or_else(|_| "gpt-image-1".to_string());
    // Model used when reference photos are available: one tuned for image
    // blending (FLUX.2-pro gives a balanced 50/50 blend, is fast, and has no
    // celebrity moderation). Text-only falls back to base_model.
    let ref_model = std::env::var("OPENAI_IMAGE_MODEL_REF")
        .unwrap_or_else(|_| "black-forest-labs/FLUX.2-pro".to_string());

    // Bound the paid call: without a timeout a hung upstream leaves the request
    // (and the connection/worker behind it) pending indefinitely. Image gen is
    // slow, so allow a generous ceiling.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    // Reference photos lift likeness far above text-only, which retreats to a
    // generic face for named real people. Look one up per character in parallel
    // (Wikipedia). The real OpenAI Images API doesn't accept reference_images,
    // so skip the lookup there.
    let refs: Vec<String> = if is_real_openai {
        Vec::new()
    } else {
        let (r1, r2) = tokio::join!(
            fetch_reference_image(&client, character1),
            fetch_reference_image(&client, character2),
        );
        [r1, r2].into_iter().flatten().collect()
    };
    if !refs.is_empty() {
        tracing::info!("fusion using {} reference image(s)", refs.len());
    }

    let dim: u32 = std::env::var("OPENAI_IMAGE_SIZE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1024);

    // Content moderation on fusions of real public figures is non-deterministic
    // (Together/Google flags the same prompt maybe a third of the time and lets
    // an identical re-roll through). Every fusion names public figures, so a
    // single flag would otherwise fail an ordinary create — silently re-roll a
    // moderation block a few times before surfacing the error. Non-moderation
    // errors (auth, billing, bad params) fail fast without retrying.
    let max_attempts: u32 = std::env::var("OPENAI_IMAGE_MAX_ATTEMPTS")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n| n >= 1)
        .unwrap_or(4);
    // Model, prompt and body all depend on whether references are in play, and
    // a rejected reference flips this off mid-loop — so build them per attempt.
    let mut use_refs = !refs.is_empty();
    let mut attempt: u32 = 0;

    loop {
        attempt += 1;
        let model = if use_refs && !is_real_openai {
            ref_model.clone()
        } else {
            base_model.clone()
        };
        let prompt = fusion_prompt(character1, character2, name, style_clause, use_refs);
        let mut req_body = json!({
            "model": model,
            "prompt": prompt,
            "n": 1,
        });
        if is_real_openai {
            // OpenAI's Images API takes a single "size" string and accepts the
            // proprietary moderation tier. Fusions name real public figures;
            // default moderation rejects most outright — "low" is the relaxed tier.
            req_body["size"] = json!(format!("{dim}x{dim}"));
            req_body["moderation"] = json!("low");
        } else {
            // Together AI, DeepInfra, etc. take width/height rather than a size
            // string and return a URL unless b64_json is asked. reference_images
            // is an array of portrait URLs the model blends.
            req_body["width"] = json!(dim);
            req_body["height"] = json!(dim);
            req_body["response_format"] = json!("b64_json");
            if use_refs {
                req_body["reference_images"] = json!(refs);
            }
            if let Some(steps) = std::env::var("OPENAI_IMAGE_STEPS")
                .ok()
                .and_then(|s| s.parse::<u32>().ok())
            {
                req_body["steps"] = json!(steps);
            }
        }

        let resp = client
            .post(format!("{base}/images/generations"))
            .bearer_auth(&api_key)
            .json(&req_body)
            .send()
            .await
            .context("OpenAI image request failed")?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .context("OpenAI image response was not JSON")?;

        if !status.is_success() {
            // Surface the API's own error message — it's the actionable part
            // (billing, org verification for gpt-image-1, content policy, etc.).
            let msg = body
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown error");
            let code = body
                .get("error")
                .and_then(|e| e.get("code"))
                .and_then(|c| c.as_str())
                .unwrap_or("");
            let lower = msg.to_lowercase();
            let err_detail = format!("({status}): {msg}");

            // A rejected reference image (bad/oversized thumbnail) — drop the
            // references and retry text-only rather than failing the create.
            // Happens at most once (use_refs never flips back on), so it can't
            // loop, and it doesn't consume the moderation-retry budget.
            if use_refs && lower.contains("reference image") {
                tracing::warn!("reference image rejected, falling back to text-only: {msg}");
                use_refs = false;
                attempt -= 1;
                continue;
            }

            let moderated = code == "content_policy_violation"
                || lower.contains("moderation")
                || lower.contains("content policy");
            if moderated && attempt < max_attempts {
                tracing::warn!(
                    "fusion image flagged by content moderation (attempt {attempt}/{max_attempts}), re-rolling"
                );
                continue;
            }
            return Err(anyhow!("OpenAI image generation failed {err_detail}"));
        }

        let first = body
            .get("data")
            .and_then(|d| d.get(0))
            .context("image response missing data[0]")?;

        let bytes = if let Some(b64) = first.get("b64_json").and_then(|b| b.as_str()) {
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .context("Failed to decode base64 image")?
        } else if let Some(url) = first.get("url").and_then(|u| u.as_str()) {
            // Some compatible providers return a short-lived URL even when
            // b64_json was requested — fetch it before it expires.
            client
                .get(url)
                .send()
                .await
                .context("failed to fetch generated image url")?
                .error_for_status()
                .context("generated image url returned an error")?
                .bytes()
                .await
                .context("generated image url had no body")?
                .to_vec()
        } else {
            return Err(anyhow!("image response has neither b64_json nor url"));
        };

        return Ok(GeneratedImage {
            bytes,
            ext: "png",
            content_type: "image/png",
        });
    }
}

/// Deterministic placeholder for localnet: a DiceBear identicon seeded by the
/// two characters, so the same pairing always yields the same image and the
/// create -> S3 -> launch pipeline is exercisable without an API key.
async fn generate_mock(
    character1: &str,
    character2: &str,
    style_clause: &str,
) -> Result<GeneratedImage> {
    // Style in the seed so different styles yield different placeholders.
    let seed = format!("{}-x-{}-{}", character1.trim(), character2.trim(), style_clause);
    let url = format!(
        "https://api.dicebear.com/9.x/identicon/png?seed={}&backgroundColor=131208&size=512",
        urlencoding(&seed)
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let bytes = client
        .get(&url)
        .send()
        .await
        .context("mock image fetch failed")?
        .error_for_status()
        .context("mock image provider returned an error")?
        .bytes()
        .await
        .context("mock image had no body")?
        .to_vec();
    Ok(GeneratedImage {
        bytes,
        ext: "png",
        content_type: "image/png",
    })
}

/// Minimal percent-encoding for a query value (avoids pulling a new dep).
fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_style_blank_picks_curated() {
        for input in [None, Some(""), Some("  ")] {
            let s = resolve_style(input);
            assert!(STYLES.iter().any(|(label, _)| *label == s.label));
            assert!(!s.clause.is_empty());
        }
    }

    #[test]
    fn resolve_style_curated_match_is_case_insensitive() {
        let s = resolve_style(Some("  cyberpunk NEON "));
        assert_eq!(s.label, "Cyberpunk neon");
        assert!(s.clause.contains("cyberpunk neon style"));
    }

    #[test]
    fn resolve_style_free_text_passes_through() {
        let s = resolve_style(Some("cyberpunk noir"));
        assert_eq!(s.label, "cyberpunk noir");
        assert!(s.clause.contains("cyberpunk noir"));
        // Free text is used verbatim, and the prompt embeds the style clause.
        let p = fusion_prompt("A", "B", Some("AB"), &s.clause);
        assert!(p.contains(&s.clause));
        assert!(!p.contains("not anime"));
    }
}
