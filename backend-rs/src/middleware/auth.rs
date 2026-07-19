use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use sha3::{Digest, Keccak256};

use crate::errors::AppError;

/// Recover the Ethereum address from a personal_sign message and signature.
/// Message is the raw text that was signed.
/// Signature is a hex string (with or without 0x prefix), 65 bytes (r + s + v).
pub fn recover_address(message: &str, signature: &str) -> Result<String, AppError> {
    let sig_hex = signature.strip_prefix("0x").unwrap_or(signature);

    let sig_bytes = hex::decode(sig_hex)
        .map_err(|e| AppError::BadRequest(format!("Invalid signature hex: {e}")))?;

    if sig_bytes.len() != 65 {
        return Err(AppError::BadRequest(format!(
            "Signature must be 65 bytes, got {}",
            sig_bytes.len()
        )));
    }

    let r_s = &sig_bytes[..64];
    let mut v = sig_bytes[64];

    // Normalize v: EIP-155 uses 27/28, k256 expects 0/1
    if v >= 27 {
        v -= 27;
    }

    let recovery_id = RecoveryId::try_from(v)
        .map_err(|e| AppError::BadRequest(format!("Invalid recovery id: {e}")))?;

    let signature = Signature::from_slice(r_s)
        .map_err(|e| AppError::BadRequest(format!("Invalid signature bytes: {e}")))?;

    // EIP-191 prefixed message
    let prefix = format!("\x19Ethereum Signed Message:\n{}", message.len());
    let mut hasher = Keccak256::new();
    hasher.update(prefix.as_bytes());
    hasher.update(message.as_bytes());
    let msg_hash = hasher.finalize();

    let verifying_key = VerifyingKey::recover_from_prehash(&msg_hash, &signature, recovery_id)
        .map_err(|e| AppError::Unauthorized(format!("Signature recovery failed: {e}")))?;

    // Derive address: Keccak256 of the uncompressed public key (skip the 0x04 prefix byte),
    // then take the last 20 bytes.
    let pubkey_bytes = verifying_key.to_encoded_point(false);
    let pubkey_uncompressed = &pubkey_bytes.as_bytes()[1..]; // skip 0x04 prefix

    let mut addr_hasher = Keccak256::new();
    addr_hasher.update(pubkey_uncompressed);
    let addr_hash = addr_hasher.finalize();

    let address_bytes = &addr_hash[12..]; // last 20 bytes
    let address = format!("0x{}", hex::encode(address_bytes));

    Ok(address)
}

/// Verify that the recovered address matches the expected address (case-insensitive).
pub fn verify_signature(
    message: &str,
    signature: &str,
    expected_address: &str,
) -> Result<bool, AppError> {
    let recovered = recover_address(message, signature)?;
    Ok(recovered.eq_ignore_ascii_case(expected_address))
}

/// How long a signed message stays valid. Replaying a signature older than this
/// (e.g. one captured months ago) is rejected.
pub const SIGNATURE_MAX_AGE_MS: i64 = 10 * 60 * 1000; // 10 minutes
/// Allowance for client/server clock skew when the timestamp is slightly ahead.
const SIGNATURE_FUTURE_SKEW_MS: i64 = 60 * 1000; // 1 minute

/// Extract the millisecond UNIX timestamp the frontend appends to every signed
/// message (the last run of 10+ digits, e.g. the trailing `${Date.now()}`).
fn extract_timestamp_ms(message: &str) -> Option<i64> {
    let bytes = message.as_bytes();
    let mut end = bytes.len();
    // scan from the end for the last maximal digit run
    while end > 0 {
        if bytes[end - 1].is_ascii_digit() {
            let mut start = end;
            while start > 0 && bytes[start - 1].is_ascii_digit() {
                start -= 1;
            }
            let run = &message[start..end];
            if run.len() >= 10 {
                return run.parse::<i64>().ok();
            }
            end = start;
        } else {
            end -= 1;
        }
    }
    None
}

/// Recover the signer and enforce anti-replay: the message must (optionally) begin
/// with `required_prefix` (binds the signature to a specific action) and must carry
/// a fresh trailing timestamp. Returns the recovered lowercase address.
///
/// This defeats long-lived replay (an old captured signature no longer works) and
/// cross-action reuse (a "Register" signature can't drive "Update profile").
/// It does NOT dedup reuse within the freshness window — for that, add a
/// server-issued single-use nonce store (Redis/DB) keyed by signature.
pub fn recover_fresh(
    message: &str,
    signature: &str,
    required_prefix: Option<&str>,
    now_ms: i64,
) -> Result<String, AppError> {
    if let Some(prefix) = required_prefix {
        if !message.starts_with(prefix) {
            return Err(AppError::Unauthorized(
                "Signed message does not match the requested action".to_string(),
            ));
        }
    }

    let ts = extract_timestamp_ms(message).ok_or_else(|| {
        AppError::Unauthorized("Signed message missing timestamp".to_string())
    })?;

    let age = now_ms - ts;
    if age > SIGNATURE_MAX_AGE_MS {
        return Err(AppError::Unauthorized("Signature expired".to_string()));
    }
    if age < -SIGNATURE_FUTURE_SKEW_MS {
        return Err(AppError::Unauthorized("Signature timestamp in the future".to_string()));
    }

    recover_address(message, signature)
}

/// Full signed-action verification: freshness + action-binding (`recover_fresh`)
/// PLUS single-use enforcement — the signature is recorded in Redis for its
/// validity window so it cannot be replayed even within the freshness window.
///
/// Fail-CLOSED on Redis errors: if the single-use store is unreachable we reject
/// the action rather than silently degrading to replay-able within the freshness
/// window. For a financial app the correct posture is to refuse the mutation when
/// the anti-replay guard can't be enforced; Redis is expected to be HA in prod.
pub async fn verify_signed_action(
    state: &crate::AppState,
    message: &str,
    signature: &str,
    required_prefix: Option<&str>,
) -> Result<String, AppError> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let recovered = recover_fresh(message, signature, required_prefix, now_ms)?;

    // Key the single-use nonce on the MESSAGE hash, not the raw signature. ECDSA
    // is malleable — (r, s) and (r, n−s) recover the same signer — so keying on the
    // signature bytes would let a mutated copy slip past with a fresh key. The
    // message embeds a unique timestamp, so it's the stable single-use identity.
    let mut hasher = Keccak256::new();
    hasher.update(message.as_bytes());
    let key = format!("sig_nonce:{}", hex::encode(hasher.finalize()));
    let ttl_secs = (SIGNATURE_MAX_AGE_MS / 1000) + 60;

    let mut conn = state.redis_conn.clone();

    // SET key 1 NX EX ttl -> Some on first use, None if it already exists.
    let res: Option<String> = redis::cmd("SET")
        .arg(&key)
        .arg(1)
        .arg("NX")
        .arg("EX")
        .arg(ttl_secs)
        .query_async(&mut conn)
        .await
        .map_err(|e| {
            tracing::error!("Redis nonce check failed (fail-closed): {e}");
            AppError::Internal(anyhow::anyhow!(
                "Anti-replay store unavailable; try again shortly"
            ))
        })?;
    if res.is_none() {
        return Err(AppError::Unauthorized("Signature already used".to_string()));
    }

    Ok(recovered)
}

#[cfg(test)]
mod anti_replay_tests {
    use super::*;

    #[test]
    fn extracts_trailing_ms_timestamp() {
        assert_eq!(extract_timestamp_ms("Update profile\n0xabc\n1730000000000"), Some(1730000000000));
        assert_eq!(extract_timestamp_ms("Upload avatar 0xabc 1730000000000"), Some(1730000000000));
        assert_eq!(extract_timestamp_ms("no timestamp here"), None);
        assert_eq!(extract_timestamp_ms("short 12345"), None); // < 10 digits
    }

    #[test]
    fn rejects_stale_and_wrong_prefix() {
        let now = 1_730_000_600_001i64; // > 10min after ts below
        // stale timestamp
        assert!(recover_fresh("Update profile\n1730000000000", "0x00", None, now).is_err());
        // wrong action prefix (fails before recovery)
        let fresh = format!("Register on Fyuz\n{}", now);
        assert!(recover_fresh(&fresh, "0x00", Some("Update profile"), now).is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recover_address_invalid_hex() {
        let result = recover_address("hello", "not_hex");
        assert!(result.is_err());
    }

    #[test]
    fn test_recover_address_wrong_length() {
        let result = recover_address("hello", "0xdeadbeef");
        assert!(result.is_err());
    }

    #[test]
    fn test_verify_signature_delegates_to_recover() {
        // A 65-byte signature that will fail recovery produces an error
        let sig = format!("0x{}", "00".repeat(65));
        let result = verify_signature("hello", &sig, "0x0000000000000000000000000000000000000000");
        // Should error during recovery (invalid signature)
        assert!(result.is_err());
    }
}
