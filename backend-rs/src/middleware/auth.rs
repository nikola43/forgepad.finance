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
