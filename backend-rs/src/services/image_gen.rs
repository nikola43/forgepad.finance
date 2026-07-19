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
/// (near-black backdrop, citron-left/magenta-right rim light, one thin orange
/// ring behind the head — brand §11) is reinterpreted in each style's own
/// visual language.
pub const STYLES: &[(&str, &str)] = &[
    ("Dragon Ball Z / anime action", "Rendered as high-energy Dragon Ball Z style anime action art: bold cel shading with hard two-tone shadows, thick confident linework, spiky gravity-defying hair, fierce determined expression, a crackling golden ki aura with electric arcs. Deep near-black tournament-night background; a citron-green rim light from the left, a magenta rim light from the right, and one thin glowing orange energy ring behind the head."),
    ("Cyberpunk neon", "Rendered in cyberpunk neon style: rain-flecked skin lit by holographic advertisements, subtle chrome implants and glowing circuit tattoos, a high techwear collar, teal-and-magenta neon reflections, cinematic haze. Near-black megacity night background; citron-green neon rim light from the left, hot magenta neon from the right, and one thin glowing orange halo-ring of light behind the head."),
    ("Medieval fantasy", "Rendered as painterly medieval fantasy art: ornate engraved armor or embroidered robes with fur and leather trim, a weathered heroic face, epic oil-illustration brushwork like a fantasy book cover. Dark castle-hall gloom behind; green torch-fire rim light from the left, rose-magenta arcane glow from the right, and one thin glowing orange rune-ring floating behind the head."),
    ("Studio Ghibli-style", "Rendered as a gentle hand-drawn Ghibli-style animation still: soft rounded features, warm expressive eyes, clean thin outlines, painterly gouache shading, wind-touched hair, quiet wonder in the expression. Deep dusk-dark background with soft painterly texture; a gentle green lantern glow from the left, a pink twilight glow from the right, and one thin warm orange ring of light behind the head."),
    ("Pixel art / 8-bit", "Rendered as retro pixel art: a chunky 16-bit character portrait with crisp pixel clusters, a limited 16-color palette, dithered shading, sharp jagged silhouette, arcade fighting-game select-screen framing. Near-black pixel background; lime-green pixel rim light on the left edge, magenta pixel rim light on the right, and one thin orange pixel ring behind the head."),
    ("Film noir comic", "Rendered as film noir comic art: stark high-contrast black-and-white inks, chiaroscuro slabs of shadow, venetian-blind light slats across the face, a trench-coat collar in cigarette-smoke atmosphere, rough brush and halftone texture. Pitch-black background; one hard pale-green key light from the left, a faint magenta gleam from the right, and one thin glowing orange ring behind the head as the only spot of color."),
    ("Classic superhero comic", "Rendered as classic Silver-Age superhero comic art: bold black ink outlines, Ben-Day halftone dots, dynamic heroic chest-up pose, saturated primary-color costume, vintage newsprint texture. Dark inked background with a burst of speedlines; green rim light from the left, magenta rim light from the right, and one thin glowing orange power-ring behind the head."),
    ("Renaissance oil painting", "Rendered as a Renaissance oil painting: sfumato blending and warm chiaroscuro, glazed earth tones with deep umber shadows, period drapery, dignified three-quarter lighting, fine craquelure varnish texture, old-master museum quality. Near-black gallery background; a subtle green-gold rim from the left, a faint rose glow from the right, and one thin gilded orange halo behind the head like a saint's ring."),
    ("Claymation / stop-motion", "Rendered as a claymation stop-motion puppet: visible thumbprints in soft plasticine, slightly lumpy handcrafted features, glossy bead eyes, felt and wire costume details, miniature-set shallow depth of field. Dark miniature-stage background; a green stage-gel light from the left, a pink gel from the right, and one thin glowing orange wire-ring suspended behind the head."),
    ("Retro 80s synthwave", "Rendered in retro 80s synthwave style: airbrushed chrome-and-sunset gradients, mirrored aviators or glowing eyes, popped jacket collar, scanline shimmer and VHS chroma bleed. Deep purple-black horizon with a faint neon grid; electric lime rim light from the left, hot pink rim light from the right, and one thin glowing orange sun-ring behind the head."),
    ("Steampunk", "Rendered in steampunk style: polished brass goggles pushed up on the brow, a Victorian waistcoat with gear-and-rivet details, coiled copper piping and wisps of steam, warm sepia-and-bronze palette with painterly grit. Dark boiler-room background; green gaslight rim from the left, rose furnace-glow from the right, and one thin glowing orange clockwork ring of tiny gears behind the head."),
    ("Wild West", "Rendered as cinematic Wild West art: a weathered wide-brim hat, sun-cracked squinting features, a dusty duster coat and bandana, warm ochre grit in the air, painted like a spaghetti-western poster. Near-black saloon dark behind; green oil-lamp rim light from the left, dusty rose sunset light from the right, and one thin glowing orange rope-ring behind the head."),
    ("Ancient mythology (Greek/Norse)", "Rendered as ancient mythology art: a godlike figure with marble-smooth skin or braided battle-worn hair, bronze and gold ornamentation, laurels or carved runes, storm clouds and epic grandeur painted like a temple mural. Near-black temple darkness; green Aegean rim light from the left, wine-rose glow from the right, and one thin glowing orange ring behind the head like a divine halo."),
    ("Space opera / sci-fi epic", "Rendered as space opera concept art: a sleek high-collared command uniform or segmented exosuit, starlight catching brushed metal, a nebula's glow on the face, cinematic sci-fi matte-painting finish. Deep-space black background with faint stars; citron-green console light from the left, magenta nebula light from the right, and one thin glowing orange orbital ring behind the head."),
    ("Watercolor illustration", "Rendered as a fine watercolor illustration: translucent layered washes, soft wet-in-wet blooms along the edges, controlled dry-brush detail in the face, pigment granulation and visible cold-press paper texture. Dark ink-wash background; a green wash glowing from the left, a rose wash from the right, and one thin orange painted ring circling behind the head."),
    ("Graffiti / street art", "Rendered as graffiti street art on a dark wall: confident spray-paint strokes with soft overspray, crisp stencil edges, wildstyle energy, paint drips running from the jawline, sticker-and-tag texture at the margins. Near-black concrete background; acid-green spray glow from the left, magenta spray glow from the right, and one thin dripping orange spray-paint ring behind the head."),
    ("Samurai / feudal Japan", "Rendered as ukiyo-e influenced samurai art: flat elegant woodblock linework, lacquered armor plates or an indigo-dyed kimono, a topknot or kabuto helmet, drifting cherry-blossom petals, washi paper grain and ink-wash clouds. Near-black indigo night; green paper-lantern glow from the left, plum-blossom pink glow from the right, and one thin glowing orange enso brush-ring behind the head."),
    ("Post-apocalyptic wasteland", "Rendered as post-apocalyptic wasteland art: cracked goggles and a patched respirator hanging at the neck, scavenged plate armor over sun-bleached rags, dust-scoured skin, rust and ash palette, gritty cinematic concept-art finish. Near-black storm-dark background; toxic green rim light from the left, ember-rose glow from the right, and one thin glowing orange ring behind the head like a dying sun."),
    ("Pop art (Warhol-style)", "Rendered as Warhol-style pop art: flat silkscreened color blocks with deliberately offset registration, high-contrast posterized features, bold unnatural color choices, visible screenprint grain. Near-black backdrop panel; a lime-green color-field edge on the left, a magenta field on the right, and one thin flat orange ring printed behind the head."),
    ("Gothic horror", "Rendered as gothic horror art: porcelain-pale skin, sunken candlelit eyes, a high lace or leather collar, Victorian dark-romance styling, engraved silver details, oil-dark painterly dread. Pitch-black crypt background with faint fog; sickly green candle rim light from the left, blood-rose glow from the right, and one thin glowing orange ring behind the head like a cursed halo."),
    ("Egyptian mythology", "Rendered as ancient Egyptian mythology art: a gold-and-lapis pharaonic headdress, kohl-lined eyes, a broad jeweled collar, hieroglyph-carved details, burnished gold-leaf highlights against basalt. Near-black tomb darkness; green scarab-glow rim light from the left, rose desert-dusk light from the right, and one thin glowing orange sun-disk ring behind the head."),
    ("Cartoon Network style", "Rendered as a modern Cartoon Network style character: thick clean vector outlines, flat saturated color fills, exaggerated playful proportions with a big expressive head, snappy 2D TV-animation finish. Near-black flat background; lime-green rim glow from the left, magenta rim glow from the right, and one thin bold orange ring drawn behind the head."),
    ("Vaporwave", "Rendered in vaporwave style: dreamy pastel pink-and-teal gradients washing over marble-white skin like a classical bust, glitch slices and RGB channel splits, faint retro-computer artifacts, nostalgic digital haze. Deep violet-black backdrop; seafoam-green glow from the left, bubblegum-pink glow from the right, and one thin glowing orange ring behind the head."),
    ("Baroque royal portrait", "Rendered as a Baroque royal portrait: dramatic tenebrism with a single shaft of light, opulent velvet and gold-braided regalia, a lace ruff or jeweled chain, rich impasto highlights over deep glazes, grand old-master gravitas. Near-black palace shadow; a green-gold gleam from the left, a crimson-rose gleam from the right, and one thin gilded orange ring behind the head."),
    ("Manga black-and-white", "Rendered as black-and-white manga art: precise G-pen ink linework, layered screentone shading, dramatic cross-hatching, expressive glossy eyes with sharp highlights, speed-lines radiating tension, crisp tankobon print quality. Solid black background; a pale green-tinted rim from the left, a soft grey-pink rim from the right, and one thin glowing orange ring behind the head as the single spot of color."),
];

/// The style actually used for a generation: the canonical label (persisted on
/// the token, shown in the UI) and the prompt clause fed to the image model.
pub struct ResolvedStyle {
    pub label: String,
    pub clause: String,
}

/// Resolve the creator's style input: blank → random curated pick; a curated
/// label (case-insensitive) → its tuned prompt clause; anything else → the
/// free text used directly as a style directive.
pub fn resolve_style(input: Option<&str>) -> ResolvedStyle {
    let input = input.map(str::trim).unwrap_or("");
    if input.is_empty() {
        use rand::RngExt;
        let (label, clause) = STYLES[rand::rng().random_range(0..STYLES.len())];
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
             visual language, wardrobe, palette, and mood. Near-black dark \
             background in that style; a citron-green rim light from the left, a \
             magenta rim light from the right, and one thin glowing orange ring \
             behind the head."
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
fn fusion_prompt(character1: &str, character2: &str, name: Option<&str>, style_clause: &str) -> String {
    let named = match name {
        Some(n) if !n.trim().is_empty() => {
            format!(" The resulting character is called \"{}\".", n.trim())
        }
        _ => String::new(),
    };
    format!(
        "A single fused character that merges \"{c1}\" and \"{c2}\" into one new \
         person, blending recognizable facial features of both.{named} Chest-up \
         portrait, centered, facing camera, one character only. {style} Sharp, \
         high detail. No text, no watermark, no logos, no borders.",
        c1 = character1.trim(),
        c2 = character2.trim(),
        named = named,
        style = style_clause,
    )
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
    let prompt = fusion_prompt(character1, character2, name, style_clause);

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
/// against compatible serverless providers (Together AI, DeepInfra, …) serving
/// open models like FLUX schnell — select via OPENAI_API_BASE +
/// OPENAI_IMAGE_MODEL. Provider quirks handled here:
///   - real OpenAI: always returns b64_json; accepts the proprietary
///     "moderation" param (needed — fusions name real public figures).
///   - compatible providers: default to returning a URL, so we request
///     b64_json explicitly and still accept a URL response as fallback;
///     unknown params like "moderation" can be rejected, so it's only sent
///     to api.openai.com.
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
    let model =
        std::env::var("OPENAI_IMAGE_MODEL").unwrap_or_else(|_| "gpt-image-1".to_string());
    let is_real_openai = base.contains("api.openai.com");

    let prompt = fusion_prompt(character1, character2, name, style_clause);

    // Bound the paid call: without a timeout a hung upstream leaves the request
    // (and the connection/worker behind it) pending indefinitely. Image gen is
    // slow, so allow a generous ceiling.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut req_body = json!({
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": "1024x1024",
    });
    if is_real_openai {
        // Fusions name real public figures; default moderation rejects most
        // of those outright. "low" is the documented relaxed tier.
        req_body["moderation"] = json!("low");
    } else {
        req_body["response_format"] = json!("b64_json");
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
        return Err(anyhow!("OpenAI image generation failed ({status}): {msg}"));
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

    Ok(GeneratedImage {
        bytes,
        ext: "png",
        content_type: "image/png",
    })
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
