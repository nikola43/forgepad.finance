use chrono::{DateTime, Utc};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::users;

/// Queryable struct -- field order matches `users` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable, Serialize, Deserialize)]
#[diesel(table_name = users)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct User {
    pub id: i32,
    pub address: String,
    pub username: Option<String>,
    pub avatar: Option<String>,
    pub bio: Option<String>,
    pub likes: i32,
    pub twitter_id: Option<String>,
    pub twitter_name: Option<String>,
    pub twitter_username: Option<String>,
    pub twitter_access: Option<String>,
    pub twitter_profile_picture: Option<String>,
    pub twitter_verified: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Insertable struct for creating new users.
#[derive(Debug, Clone, Insertable, Deserialize)]
#[diesel(table_name = users)]
pub struct NewUser<'a> {
    pub address: &'a str,
    pub username: Option<&'a str>,
    pub avatar: Option<&'a str>,
    pub bio: Option<&'a str>,
}

/// Response DTO sent to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserResponse {
    pub id: i32,
    pub address: String,
    pub username: Option<String>,
    pub avatar: Option<String>,
    pub bio: Option<String>,
    pub likes: i32,
    pub is_admin: Option<bool>,
    /// X/Twitter handle (no @), user-set from the profile page.
    pub twitter_username: Option<String>,
}

impl From<User> for UserResponse {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            address: u.address,
            username: u.username,
            avatar: u.avatar,
            bio: u.bio,
            likes: u.likes,
            is_admin: None,
            twitter_username: u.twitter_username,
        }
    }
}
