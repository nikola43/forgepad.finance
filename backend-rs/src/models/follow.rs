use chrono::{DateTime, Utc};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::follows;

/// Queryable struct -- field order matches `follows` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = follows)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct Follow {
    pub id: i32,
    pub follower_id: i32,
    pub followee_id: i32,
    pub created_at: DateTime<Utc>,
}

/// Insertable struct for creating a new follow relationship.
#[derive(Debug, Clone, Insertable, Deserialize)]
#[diesel(table_name = follows)]
pub struct NewFollow {
    pub follower_id: i32,
    pub followee_id: i32,
}
