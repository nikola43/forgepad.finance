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

/// Build the Fyuz fusion prompt from two characters (brand §11).
///
/// One fused character, chest-up and centered, staged in the dark "chamber"
/// under two-source rim light (citron left, plum rose right) with a single
/// tangerine reaction ring — the brand's visual fingerprint. Deliberately bans
/// text/watermarks/anime so results stay on-brand and usable as a token logo.
fn fusion_prompt(character1: &str, character2: &str, name: Option<&str>) -> String {
    let named = match name {
        Some(n) if !n.trim().is_empty() => {
            format!(" The resulting character is called \"{}\".", n.trim())
        }
        _ => String::new(),
    };
    format!(
        "A single fused character that merges \"{c1}\" and \"{c2}\" into one new \
         person, blending recognizable facial features of both.{named} Chest-up \
         portrait, centered, facing camera, one character only. Dramatic event \
         lighting: a citron/lime-green rim light from the left, a magenta/pink rim \
         light from the right, and a warm key light from the front. Near-black dark \
         studio background (deep warm black), flat and clean, no scenery. One thin \
         glowing orange ring behind the head. Photographic, sharp, high detail, \
         staged like a specimen under event lighting. No text, no watermark, no \
         logos, no borders, not anime, not cartoon.",
        c1 = character1.trim(),
        c2 = character2.trim(),
        named = named,
    )
}

/// Generate a fusion image. Returns PNG (or SVG for the mock) bytes.
pub async fn generate_fusion(
    character1: &str,
    character2: &str,
    name: Option<&str>,
) -> Result<GeneratedImage> {
    let provider = std::env::var("IMAGE_GEN_PROVIDER").unwrap_or_else(|_| "openai".to_string());
    match provider.as_str() {
        "mock" => generate_mock(character1, character2).await,
        "openai" => generate_openai(character1, character2, name).await,
        other => Err(anyhow!("Unknown IMAGE_GEN_PROVIDER: {other}")),
    }
}

/// OpenAI Images API — gpt-image-1. The model always returns base64 (no url
/// option), so we decode b64_json into PNG bytes.
async fn generate_openai(
    character1: &str,
    character2: &str,
    name: Option<&str>,
) -> Result<GeneratedImage> {
    let api_key = std::env::var("OPENAI_API_KEY")
        .ok()
        .filter(|k| !k.is_empty())
        .context("OPENAI_API_KEY is not set — cannot generate token image")?;
    let base = std::env::var("OPENAI_API_BASE")
        .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
    let model =
        std::env::var("OPENAI_IMAGE_MODEL").unwrap_or_else(|_| "gpt-image-1".to_string());

    let prompt = fusion_prompt(character1, character2, name);

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base}/images/generations"))
        .bearer_auth(&api_key)
        .json(&json!({
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": "1024x1024",
            // Fusions name real public figures; default moderation rejects most
            // of those outright. "low" is the documented relaxed tier.
            "moderation": "low",
        }))
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

    let b64 = body
        .get("data")
        .and_then(|d| d.get(0))
        .and_then(|d| d.get("b64_json"))
        .and_then(|b| b.as_str())
        .context("OpenAI image response missing data[0].b64_json")?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .context("Failed to decode base64 image from OpenAI")?;

    Ok(GeneratedImage {
        bytes,
        ext: "png",
        content_type: "image/png",
    })
}

/// Deterministic placeholder for localnet: a DiceBear identicon seeded by the
/// two characters, so the same pairing always yields the same image and the
/// create -> S3 -> launch pipeline is exercisable without an API key.
async fn generate_mock(character1: &str, character2: &str) -> Result<GeneratedImage> {
    let seed = format!("{}-x-{}", character1.trim(), character2.trim());
    let url = format!(
        "https://api.dicebear.com/9.x/identicon/png?seed={}&backgroundColor=131208&size=512",
        urlencoding(&seed)
    );
    let bytes = reqwest::get(&url)
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
