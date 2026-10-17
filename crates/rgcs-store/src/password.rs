//! Argon2id password hashing (PHC string format).

use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use argon2::Argon2;

use crate::StoreError;

/// Hashes with a fresh random 128-bit salt.
pub fn hash_password(password: &str) -> Result<String, StoreError> {
    let salt = uuid::Uuid::new_v4();
    Argon2::default()
        .hash_password_with_salt(password.as_bytes(), salt.as_bytes())
        .map(|h| h.to_string())
        .map_err(|e| StoreError::Password(e.to_string()))
}

/// Constant-time verification; a malformed stored hash counts as a mismatch.
pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    match argon2::password_hash::phc::PasswordHash::new(stored_hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_round_trips_and_rejects_wrong_password() {
        let h = hash_password("admin").unwrap();
        assert!(h.starts_with("$argon2id$"));
        assert!(verify_password("admin", &h));
        assert!(!verify_password("Admin", &h));
        assert!(!verify_password("admin", "garbage"));
    }

    #[test]
    fn salts_differ_between_hashes() {
        assert_ne!(hash_password("x").unwrap(), hash_password("x").unwrap());
    }
}
